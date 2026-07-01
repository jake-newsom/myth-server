import { Namespace, Server, Socket } from "socket.io";
import { socketAuthMiddleware } from "./socket.auth.middleware";
import gameService from "../services/game.service";
import GameRewardsService from "../services/gameRewards.service";
import {
  AuthenticatedSocket,
  JoinGamePayload,
  ServerJoinedResponse,
  GameNamespaceEvent,
  GameActionPayload,
  ServerChoiceRequiredPayload,
} from "../types/socket.types";
import { InGameCard } from "../types/card.types";
import {
  applyPlayerMulligan,
  finalizeMulliganIfReady,
  MULLIGAN_DURATION_SECONDS,
  MAX_MULLIGAN_REPLACEMENTS,
  resolveLegacyMulliganBeforeAction,
  skipMulliganPhase,
} from "../game-engine/game.mulligan";
import { clientSupportsMulligan } from "../utils/clientVersion";

import { TurnManager } from "./turn.manager";
import { GameLogic, GameStatus } from "../game-engine/game.logic";
import { AILogic } from "../game-engine/ai.logic";
import { resolveAIDifficulty } from "../game-engine/ai.difficulty";
import {
  clearActiveMatch,
  matchmakingQueue,
} from "../api/controllers/matchmaking.controller";
import { sanitizeGameStateForPlayer } from "../utils/sanitize";
import {
  pacePowerEvents,
  sumAnimationDelay,
} from "../game-engine/game-events";
import logger from "../utils/logger";

// Users with an active /game namespace socket connection.
const gameNamespaceConnectedUsers = new Set<string>();

export function getGameNamespaceConnectedUserIds(): string[] {
  return Array.from(gameNamespaceConnectedUsers);
}

/**
 * Set up the `/game` Socket.IO namespace. Handles authentication and initial
 * room-join handshake for PvP games (Phase 1 of multiplayer plan).
 *
 * @param io The root Socket.IO server instance
 */
export function setupGameNamespace(io: Server): void {
  // Create or retrieve the namespace. All game related sockets live here.
  const gameNs: Namespace = io.of("/game");

  // Attach JWT authentication middleware (re-uses existing express logic).
  gameNs.use((socket, next) => socketAuthMiddleware(socket as any, next));

  // Store per-game metadata (players, turn manager, etc.)
  type GameRoomMeta = {
    playerIds: [string, string];
    turnManager: TurnManager | null;
    mulliganTimer: NodeJS.Timeout | null;
    graceTimers: Map<string, NodeJS.Timeout>;
    clientVersions: Map<string, string | undefined>;
    actionLock: Promise<void>;
  };

  const activeGames: Map<string, GameRoomMeta> = new Map();

  const bothPlayersSupportMulligan = (meta: GameRoomMeta): boolean =>
    meta.playerIds.every((pid) =>
      clientSupportsMulligan(meta.clientVersions.get(pid))
    );

  /**
   * Acquire a per-game lock to serialize action processing.
   * Returns a release function that must be called when done.
   */
  function acquireActionLock(gameId: string): Promise<() => void> {
    const meta = activeGames.get(gameId);
    if (!meta) {
      // No game metadata, return a no-op lock
      return Promise.resolve(() => { });
    }

    let release: () => void;
    const newLock = new Promise<void>((resolve) => {
      release = resolve;
    });

    // Chain onto the existing lock
    const previousLock = meta.actionLock;
    meta.actionLock = previousLock.then(() => newLock);

    // Wait for the previous lock to complete, then return the release function
    return previousLock.then(() => release!);
  }

  /**
   * Helper that sends a gameState (and optional events payload) to every socket
   * in the given room, making sure each socket only sees its own hand.
   */
  async function emitGameStateSanitized(
    gameNs: Namespace,
    room: string,
    rawState: any,
    payload: Record<string, any> = {}
  ) {
    const sockets = await gameNs.in(room).fetchSockets();
    for (const s of sockets as any) {
      const viewerId: string = s.data?.user_id ?? "";
      s.emit(GameNamespaceEvent.SERVER_EVENTS, {
        gameState: sanitizeGameStateForPlayer(rawState, viewerId),
        ...payload,
      });
    }
  }

  /**
   * Like emitGameStateSanitized but sends ONLY to the sockets belonging to a
   * single player. Used to deliver Frigg's interactive pause to the chooser
   * while the opponent receives nothing (they must not learn the move happened
   * until the choice resolves).
   */
  async function emitGameStateToPlayer(
    gameNs: Namespace,
    room: string,
    rawState: any,
    targetPlayerId: string,
    payload: Record<string, any> = {}
  ) {
    const sockets = await gameNs.in(room).fetchSockets();
    for (const s of sockets as any) {
      const viewerId: string = s.data?.user_id ?? "";
      if (viewerId !== targetPlayerId) continue;
      s.emit(GameNamespaceEvent.SERVER_EVENTS, {
        gameState: sanitizeGameStateForPlayer(rawState, viewerId),
        ...payload,
      });
    }
  }

  /**
   * Emits the SERVER_CHOICE_REQUIRED reveal to the chooser only, carrying the
   * fully hydrated candidate cards (the opponent's hand) built from the
   * UNSANITIZED state. Never sent to the opponent.
   */
  async function emitChoiceRequired(
    gameNs: Namespace,
    room: string,
    gameId: string,
    rawState: any
  ) {
    const pending = rawState.pending_choice;
    if (!pending) return;

    const cards = (pending.choosable_card_ids as string[])
      .map((id) => rawState.hydrated_card_data_cache?.[id])
      .filter((c): c is InGameCard => !!c);

    const choicePayload: ServerChoiceRequiredPayload = {
      gameId,
      type: pending.type,
      sourceCardId: pending.source_card_id,
      sourcePosition: pending.source_position,
      cards,
      selectCount: pending.select_count,
      promptTitle: pending.prompt_title,
      promptText: pending.prompt_text,
    };

    const sockets = await gameNs.in(room).fetchSockets();
    for (const s of sockets as any) {
      const viewerId: string = s.data?.user_id ?? "";
      if (viewerId !== pending.chooser_id) continue;
      s.emit(GameNamespaceEvent.SERVER_CHOICE_REQUIRED, choicePayload);
    }
  }

  async function hydrateMissingHandCardsForPlayer(
    state: any,
    playerId: string
  ): Promise<void> {
    const player =
      state.player1?.user_id === playerId
        ? state.player1
        : state.player2?.user_id === playerId
          ? state.player2
          : null;

    if (!player) return;

    const cache = state.hydrated_card_data_cache ?? {};
    const missingIds = (player.hand ?? []).filter(
      (cardId: string) => !!cardId && !cache[cardId]
    );

    if (!missingIds.length) return;

    const hydratedMap = await GameLogic.hydrateCardInstances(
      missingIds,
      playerId.startsWith("AI_") ? undefined : playerId
    );

    if (!state.hydrated_card_data_cache) {
      state.hydrated_card_data_cache = {};
    }
    for (const [cardId, cardData] of hydratedMap.entries()) {
      state.hydrated_card_data_cache[cardId] = cardData;
    }
  }

  /**
   * Returns the on-turn-timeout callback used by TurnManager. Extracted so both
   * the normal bootstrap and `onMulliganExpire` can share the same behavior.
   */
  function makeOnTurnTimeout(
    gameId: string,
    roomName: string,
    meta: GameRoomMeta
  ) {
    return async (timedOutPlayerId: string) => {
      const releaseLock = await acquireActionLock(gameId);
      try {
        const ai = new AILogic();
        const latestRecord = await gameService.getRawGameRecord(
          gameId,
          timedOutPlayerId
        );

        if (!latestRecord) return;

        if (latestRecord.game_state.current_player_id !== timedOutPlayerId) return;

        let currentState = latestRecord.game_state;
        let events: any[] = [];
        let aiMoveUsed = false;

        // If the move is paused awaiting this player's interactive choice (e.g.
        // Frigg) and they ran out of time, auto-resolve against the strongest
        // enemy hand card(s), then broadcast the full move to both players.
        if (currentState.pending_choice) {
          const chosenIds =
            GameLogic.pickStrongestPendingChoiceCards(currentState);
          if (chosenIds.length > 0) {
            const result = await GameLogic.resolveHandChoice(
              currentState,
              chosenIds
            );
            currentState = result.state;
            events = result.events;
          } else {
            // No resolvable candidate (shouldn't happen) — clear and end turn.
            currentState.pending_choice = undefined;
            const result = await GameLogic.endTurn(currentState, timedOutPlayerId);
            currentState = result.state;
            events = result.events;
          }

          await gameService.updateGameAfterAction(
            gameId,
            currentState,
            currentState.status,
            currentState.winner ?? null
          );
          events = pacePowerEvents(events);
          await emitGameStateSanitized(gameNs, roomName, currentState, {
            events,
          });

          if (meta.turnManager) {
            if (currentState.status === GameStatus.COMPLETED) {
              meta.turnManager.dispose();
              meta.turnManager = null;
              clearActiveMatch(meta.playerIds[0]);
              clearActiveMatch(meta.playerIds[1]);
            } else {
              meta.turnManager.startTurn(
                currentState.current_player_id,
                false,
                sumAnimationDelay(events)
              );
            }
          }
          return;
        }

        const aiDifficulty = resolveAIDifficulty({ isTimeoutFallback: true });
        const aiMove = await ai.makeAIMove(
          currentState,
          aiDifficulty,
          timedOutPlayerId
        );

        if (aiMove) {
          aiMoveUsed = true;
          const result = await GameLogic.placeCard(
            currentState,
            timedOutPlayerId,
            aiMove.user_card_instance_id,
            aiMove.position
          );
          currentState = result.state;
          events = result.events;

          // If the AI just played an interactive reveal-hand ability (e.g.
          // Frigg), it can't send a follow-up choice — resolve it inline against
          // the strongest enemy hand card(s) so the move completes in this same
          // tick instead of hanging.
          if (currentState.pending_choice) {
            const chosenIds =
              GameLogic.pickStrongestPendingChoiceCards(currentState);
            if (chosenIds.length > 0) {
              const choiceResult = await GameLogic.resolveHandChoice(
                currentState,
                chosenIds
              );
              currentState = choiceResult.state;
              events.push(...choiceResult.events);
            } else {
              currentState.pending_choice = undefined;
            }
          }
        } else {
          const result = await GameLogic.endTurn(currentState, timedOutPlayerId);
          currentState = result.state;
          events = result.events;
        }

        await gameService.updateGameAfterAction(
          gameId,
          currentState,
          currentState.status,
          currentState.winner ?? null
        );

        // Merge/space consecutive power-change floaters before broadcasting, and
        // derive the turn timer's animation delay from the (now paced) events.
        events = pacePowerEvents(events);

        await emitGameStateSanitized(gameNs, roomName, currentState, {
          events,
          aiMove: aiMoveUsed,
        });

        if (meta.turnManager) {
          if (currentState.status === GameStatus.COMPLETED) {
            meta.turnManager.dispose();
            meta.turnManager = null;
            clearActiveMatch(meta.playerIds[0]);
            clearActiveMatch(meta.playerIds[1]);
          } else {
            meta.turnManager.startTurn(
              currentState.current_player_id,
              false,
              sumAnimationDelay(events)
            );
          }
        }
      } catch (err) {
        console.error("[namespace.game] AI move error", err);
      } finally {
        releaseLock();
      }
    };
  }

  /**
   * Called when the 30s mulligan timer fires. Auto-commits uncommitted players
   * with empty replacements, finalizes the phase, and starts TurnManager.
   */
  async function onMulliganExpire(gameId: string, roomName: string): Promise<void> {
    const meta = activeGames.get(gameId);
    if (!meta) return;
    meta.mulliganTimer = null;

    const releaseLock = await acquireActionLock(gameId);
    try {
      const latest = await gameService.getRawGameRecord(gameId, meta.playerIds[0]);
      if (!latest) return;

      let state = latest.game_state;
      if (state.status !== GameStatus.MULLIGAN || !state.mulligan_state) return;

      const events: any[] = [];
      if (!state.mulligan_state.player1.committed) {
        const r = applyPlayerMulligan(state, meta.playerIds[0], []);
        state = r.state;
        events.push(...r.events);
      }
      if (!state.mulligan_state?.player2.committed) {
        const r = applyPlayerMulligan(state, meta.playerIds[1], []);
        state = r.state;
        events.push(...r.events);
      }
      state = finalizeMulliganIfReady(state).state;

      await gameService.updateGameAfterAction(
        gameId,
        state,
        state.status,
        state.winner ?? null
      );

      await emitGameStateSanitized(gameNs, roomName, state, { events });

      if (!meta.turnManager) {
        meta.turnManager = new TurnManager(
          gameNs,
          roomName,
          state.current_player_id,
          meta.playerIds,
          makeOnTurnTimeout(gameId, roomName, meta)
        );
        meta.turnManager.startTurn(state.current_player_id, true);
      }
    } finally {
      releaseLock();
    }
  }

  // Track per-user sockets in the /game namespace to force-disconnect duplicates
  const userGameSocketMap = new Map<string, string>(); // userId -> socketId

  // Handle new socket connections after successful auth.
  gameNs.on("connection", (socket: Socket) => {
    const authedSocket = socket as AuthenticatedSocket;
    const userId = authedSocket.user.user_id;

    // Store userId for remote socket access
    (socket as any).data.user_id = userId;

    console.log(`[/game] Connected – userId=${userId}, socketId=${socket.id}`);

    // Force-disconnect previous /game socket for this user (prevent duplicate control)
    const previousSocketId = userGameSocketMap.get(userId);
    if (previousSocketId && previousSocketId !== socket.id) {
      const previousSocket = gameNs.sockets.get(previousSocketId);
      if (previousSocket) {
        console.log(
          `[/game] Force-disconnecting previous game socket for user ${userId} (old: ${previousSocketId}, new: ${socket.id})`
        );
        previousSocket.emit("server:error", {
          message: "You have connected from another session. This connection has been closed.",
          code: "SESSION_REPLACED",
        });
        previousSocket.disconnect(true);
      }
    }
    userGameSocketMap.set(userId, socket.id);
    gameNamespaceConnectedUsers.add(userId);

    /**
     * client:join_game — Client requests to enter a game room once the REST
     * matchmaking flow has returned a valid gameId/matchToken. Payload:
     *  { gameId: string }
     */
    socket.on("client:join_game", async (payload: JoinGamePayload) => {
      try {
        if (!payload?.gameId) {
          socket.emit("server:error", {
            message: "gameId is required to join a game",
          });
          return;
        }

        const { gameId } = payload;
        const game = await gameService.findGameForUser(gameId, userId);

        if (!game) {
          socket.emit("server:error", {
            message: "Game not found or access denied",
          });
          return;
        }

        // If the game is no longer active or in mulligan, tell the client it already ended
        // instead of letting them "join" a completed/aborted game.
        if (
          game.game_status !== GameStatus.ACTIVE &&
          game.game_status !== GameStatus.MULLIGAN
        ) {
          clearActiveMatch(userId);
          socket.emit(GameNamespaceEvent.SERVER_GAME_END, {
            result: {
              winnerId: game.winner_id ?? game.game_state?.winner ?? null,
              reason: game.game_status === "aborted" ? "aborted" : "completed",
            },
          });
          return;
        }

        const roomName = `game:${gameId}`;
        socket.join(roomName);
        socket.data.gameId = gameId; // Save for disconnect handler

        // Determine which player the connecting user is.
        const playerNumber = game.player1_id === userId ? 1 : 2;

        // Debug logging for card data
        console.log(
          `[/game] join_game - Player ${playerNumber} (${userId}) joining game ${gameId}`
        );

        if (game.game_state.hydrated_card_data_cache) {
          console.log(
            `[/game] Original hydrated_card_data_cache has ${Object.keys(game.game_state.hydrated_card_data_cache).length
            } entries`
          );
        } else {
          console.log(
            `[/game] WARNING: Original game state has no hydrated_card_data_cache!`
          );
        }

        // Create sanitized game state
        const sanitizedGameState = sanitizeGameStateForPlayer(
          game.game_state,
          userId
        );

        // Log game join for debugging (only in development)
        if (process.env.NODE_ENV !== "production") {
          const playerHand =
            playerNumber === 1
              ? game.game_state.player1.hand
              : game.game_state.player2.hand;

          logger.debug("Player joined game", {
            gameId: payload.gameId,
            userId,
            playerNumber,
            handSize: playerHand.length,
            cacheEntries: sanitizedGameState.hydrated_card_data_cache
              ? Object.keys(sanitizedGameState.hydrated_card_data_cache).length
              : 0,
          });

          if (!sanitizedGameState.hydrated_card_data_cache) {
            logger.warn(
              "Sanitized game state missing hydrated_card_data_cache",
              {
                gameId: payload.gameId,
                userId,
              }
            );
          }
        }

        // Resolve the opponent's username from the already-joined query data
        const opponentUsername =
          playerNumber === 1
            ? (game as any).player2_username || "Opponent"
            : (game as any).player1_username || "Opponent";

        // Emit confirmation back only to this socket.
        const joinResponse: ServerJoinedResponse = {
          gameState: sanitizedGameState,
          playerNumber,
          opponentUsername,
        };
        socket.emit(GameNamespaceEvent.SERVER_JOINED, joinResponse);

        // If a move is paused awaiting THIS player's interactive choice (e.g.
        // they refreshed mid-Frigg), re-send the reveal so the overlay returns.
        // sanitizeGameStateForPlayer strips pending_choice, so this is the only
        // way the rejoining chooser re-learns about the pending prompt.
        const pendingChoice = (game.game_state as any).pending_choice;
        if (pendingChoice && pendingChoice.chooser_id === userId) {
          const cards = (pendingChoice.choosable_card_ids as string[])
            .map((id) => game.game_state.hydrated_card_data_cache?.[id])
            .filter((c): c is InGameCard => !!c);
          const choicePayload: ServerChoiceRequiredPayload = {
            gameId,
            type: pendingChoice.type,
            sourceCardId: pendingChoice.source_card_id,
            sourcePosition: pendingChoice.source_position,
            cards,
            selectCount: pendingChoice.select_count,
            promptTitle: pendingChoice.prompt_title,
            promptText: pendingChoice.prompt_text,
          };
          socket.emit(GameNamespaceEvent.SERVER_CHOICE_REQUIRED, choicePayload);
        }

        // Optionally notify the other peer that this player has joined.
        socket.to(roomName).emit(GameNamespaceEvent.SERVER_PLAYER_JOINED, {
          userId,
          playerNumber,
        });

        /* ---------------- Grace timer cancel on reconnect ------- */
        const existingTimer = activeGames.get(gameId)?.graceTimers.get(userId);
        if (existingTimer) {
          clearTimeout(existingTimer);
          activeGames.get(gameId)?.graceTimers.delete(userId);
        }

        /* ---------------- TurnManager bootstrap ---------------- */
        const handshakeClientVersion =
          typeof authedSocket.handshake.auth?.clientVersion === "string"
            ? authedSocket.handshake.auth.clientVersion
            : undefined;

        let meta = activeGames.get(gameId);
        if (!meta) {
          meta = {
            playerIds: [game.player1_id, game.player2_id],
            turnManager: null,
            mulliganTimer: null,
            graceTimers: new Map(),
            clientVersions: new Map(),
            actionLock: Promise.resolve(), // Initialize with resolved promise
          };
          activeGames.set(gameId, meta);
        }
        meta.clientVersions.set(userId, handshakeClientVersion);

        // If both players are present in the room, bootstrap the next phase
        const room = gameNs.adapter.rooms.get(roomName);
        if (room && room.size === 2) {
          // Re-fetch fresh record to get current status (avoid race with just-committed mulligan)
          const freshRecord = await gameService.getRawGameRecord(gameId, userId);
          if (!freshRecord) return;
          const currentStatus = freshRecord.game_state.status;

          if (currentStatus === GameStatus.MULLIGAN && !meta.mulliganTimer) {
            const releaseLock = await acquireActionLock(gameId);
            try {
              const latest = await gameService.getRawGameRecord(
                gameId,
                meta.playerIds[0]
              );
              if (!latest || latest.game_state.status !== GameStatus.MULLIGAN) {
                return;
              }

              if (bothPlayersSupportMulligan(meta)) {
                // Both clients support mulligan — run timed phase for new clients.
                const deadlineMs =
                  Date.now() + MULLIGAN_DURATION_SECONDS * 1000;
                const stateWithDeadline = {
                  ...latest.game_state,
                  mulligan_state: {
                    ...latest.game_state.mulligan_state!,
                    deadline_ms: deadlineMs,
                  },
                };
                await gameService.updateGameAfterAction(
                  gameId,
                  stateWithDeadline,
                  GameStatus.MULLIGAN,
                  null
                );
                gameNs.to(roomName).emit(GameNamespaceEvent.SERVER_MULLIGAN_START, {
                  deadline_ms: deadlineMs,
                  duration_seconds: MULLIGAN_DURATION_SECONDS,
                });
                meta.mulliganTimer = setTimeout(
                  () =>
                    onMulliganExpire(gameId, roomName).catch((err) =>
                      console.error("[namespace.game] onMulliganExpire error", err)
                    ),
                  MULLIGAN_DURATION_SECONDS * 1000
                );
              } else {
                // Legacy client in match — skip mulligan immediately (no 30s wait).
                const skipped = skipMulliganPhase(
                  latest.game_state,
                  meta.playerIds
                );
                await gameService.updateGameAfterAction(
                  gameId,
                  skipped.state,
                  skipped.state.status,
                  skipped.state.winner ?? null
                );
                await emitGameStateSanitized(gameNs, roomName, skipped.state, {
                  events: skipped.events,
                });
                if (
                  skipped.state.status === GameStatus.ACTIVE &&
                  !meta.turnManager
                ) {
                  meta.turnManager = new TurnManager(
                    gameNs,
                    roomName,
                    skipped.state.current_player_id,
                    meta.playerIds,
                    makeOnTurnTimeout(gameId, roomName, meta)
                  );
                  meta.turnManager.startTurn(
                    skipped.state.current_player_id,
                    true
                  );
                }
              }
            } finally {
              releaseLock();
            }
          } else if (currentStatus === GameStatus.ACTIVE && !meta.turnManager) {
            // Normal active-game bootstrap
            const startingPlayer = freshRecord.game_state.current_player_id;
            meta.turnManager = new TurnManager(
              gameNs,
              roomName,
              startingPlayer,
              meta.playerIds,
              makeOnTurnTimeout(gameId, roomName, meta)
            );
            meta.turnManager.startTurn(startingPlayer, true);
          }
        }
      } catch (err) {
        console.error("[namespace.game] join_game error", err);
        socket.emit("server:error", { message: "Internal server error" });
      }
    });

    socket.on(
      GameNamespaceEvent.CLIENT_ACTION,
      async (actionPayload: GameActionPayload) => {
        const { gameId, actionType, user_card_instance_id, position, targetPosition } =
          actionPayload;

        if (!gameId || !actionType) {
          socket.emit(GameNamespaceEvent.SERVER_ERROR, {
            message: "gameId and actionType are required",
          });
          return;
        }

        const roomName = `game:${gameId}`;

        // Validate that the socket has joined this game room
        const roomMembers = gameNs.adapter.rooms.get(roomName);
        if (!roomMembers || !roomMembers.has(socket.id)) {
          socket.emit(GameNamespaceEvent.SERVER_ERROR, {
            message: "You must join the game room before submitting actions",
          });
          return;
        }

        // Acquire per-game lock to serialize action processing
        const releaseLock = await acquireActionLock(gameId);

        try {
          // Fetch fresh game record (inside lock to ensure consistency)
          const gameRecord = await gameService.getRawGameRecord(gameId, userId);

          if (!gameRecord) {
            socket.emit(GameNamespaceEvent.SERVER_ERROR, {
              message: "Game not found or access denied",
            });
            return;
          }

          // Guard: non-mulligan actions are blocked during MULLIGAN phase
          if (
            gameRecord.game_state.status === GameStatus.MULLIGAN &&
            actionType !== "mulligan"
          ) {
            socket.emit(GameNamespaceEvent.SERVER_ERROR, {
              message: "Game is in mulligan phase",
            });
            return;
          }

          // Guard: mulligan action is blocked when not in MULLIGAN phase
          if (
            actionType === "mulligan" &&
            gameRecord.game_state.status !== GameStatus.MULLIGAN
          ) {
            socket.emit(GameNamespaceEvent.SERVER_ERROR, {
              message: "Mulligan phase has ended",
            });
            return;
          }

          // Validate that the game is still active (for non-mulligan actions)
          if (
            gameRecord.game_status !== GameStatus.ACTIVE &&
            gameRecord.game_state.status !== GameStatus.MULLIGAN
          ) {
            socket.emit(GameNamespaceEvent.SERVER_ERROR, {
              message: `Game is not active (status: ${gameRecord.game_status})`,
            });
            return;
          }

          let nextState = gameRecord.game_state;
          let events: any[] = [];

          // While a move is paused awaiting an interactive choice, the game is
          // frozen: only the matching handChoice action may proceed. Reject any
          // other action so a player can't place/end-turn around the pause.
          if (nextState.pending_choice && actionType !== "handChoice") {
            socket.emit(GameNamespaceEvent.SERVER_ERROR, {
              message: "Waiting for an ability choice to resolve",
            });
            return;
          }

          const meta = activeGames.get(gameId);
          const supportsMulliganUi = clientSupportsMulligan(
            meta?.clientVersions.get(userId)
          );
          const legacyResolve = resolveLegacyMulliganBeforeAction(
            nextState,
            userId,
            supportsMulliganUi
          );
          if (legacyResolve.events.length > 0) {
            nextState = legacyResolve.state;
            events.push(...legacyResolve.events);
            await gameService.updateGameAfterAction(
              gameId,
              nextState,
              nextState.status,
              nextState.winner ?? null
            );
            await emitGameStateSanitized(gameNs, roomName, nextState, {
              events: legacyResolve.events,
            });
          }

          try {
            if (actionType === "placeCard") {
              if (!user_card_instance_id || !position) {
                socket.emit(GameNamespaceEvent.SERVER_ERROR, {
                  message: "user_card_instance_id and position required",
                });
                return;
              }

              const result = await GameLogic.placeCard(
                nextState,
                userId,
                user_card_instance_id,
                position,
                targetPosition
              );
              nextState = result.state;
              events = result.events;
            } else if (actionType === "endTurn") {
              const result = await GameLogic.endTurn(nextState, userId);
              nextState = result.state;
              events = result.events;
            } else if (actionType === "forcePass") {
              const result = await GameLogic.forcePass(nextState, userId);
              nextState = result.state;
              events = result.events;
            } else if (actionType === "surrender") {
              nextState = await GameLogic.surrender(nextState, userId);
            } else if (actionType === "mulligan") {
              const replaced: string[] =
                (actionPayload as any).replaced_card_instance_ids ?? [];
              if (!Array.isArray(replaced) || replaced.length > MAX_MULLIGAN_REPLACEMENTS) {
                socket.emit(GameNamespaceEvent.SERVER_ERROR, {
                  message: `replaced_card_instance_ids must be an array of ≤ ${MAX_MULLIGAN_REPLACEMENTS}`,
                });
                return;
              }
              const r = applyPlayerMulligan(nextState, userId, replaced);
              nextState = r.state;
              events.push(...r.events);

              // Mulligan draws replacement cards directly from deck; hydrate any newly
              // drawn cards so clients can render them and timeout fallback can play them.
              await hydrateMissingHandCardsForPlayer(nextState, userId);

              nextState = finalizeMulliganIfReady(nextState).state;
            } else if (actionType === "handChoice") {
              // Resolve an interactive reveal-hand pause: the chooser picked card(s).
              const pending = nextState.pending_choice;
              const chosenCardIds =
                (actionPayload as GameActionPayload).chosen_card_ids ?? [];

              if (!pending || pending.type !== "reveal_hand_select") {
                socket.emit(GameNamespaceEvent.SERVER_ERROR, {
                  message: "No pending choice to resolve",
                });
                return;
              }
              if (userId !== pending.chooser_id) {
                socket.emit(GameNamespaceEvent.SERVER_ERROR, {
                  message: "Not your choice to make",
                });
                return;
              }
              const uniqueChosen = [...new Set(chosenCardIds)];
              if (
                uniqueChosen.length !== pending.select_count ||
                !uniqueChosen.every((id) =>
                  pending.choosable_card_ids.includes(id)
                )
              ) {
                socket.emit(GameNamespaceEvent.SERVER_ERROR, {
                  message: "Invalid chosen_card_ids",
                });
                return;
              }

              const result = await GameLogic.resolveHandChoice(
                nextState,
                uniqueChosen
              );
              nextState = result.state;
              events = result.events;
            } else {
              socket.emit(GameNamespaceEvent.SERVER_ERROR, {
                message: "Invalid actionType",
              });
              return;
            }
          } catch (err) {
            socket.emit(GameNamespaceEvent.SERVER_ERROR, {
              message: err instanceof Error ? err.message : String(err),
            });
            return;
          }

          // Persist updated state
          try {
            await gameService.updateGameAfterAction(
              gameId,
              nextState,
              nextState.status,
              nextState.winner ?? null
            );
          } catch (err) {
            console.error("[namespace.game] DB update error", err);
          }

          // Merge/space consecutive power-change floaters before broadcasting so
          // the turn timer (below) can derive its delay from the paced events.
          events = pacePowerEvents(events);

          // Interactive pause (Frigg): the move stopped after combat awaiting the
          // chooser's selection. Reveal the opponent's hand to the CHOOSER ONLY
          // (placement + combat events + the choice prompt) and send the opponent
          // NOTHING — they must not learn the move happened until it resolves. The
          // turn timer is re-armed on the same chooser so a non-response times out
          // and the AI fallback (in makeOnTurnTimeout) auto-resolves.
          if (nextState.pending_choice) {
            const chooserId = nextState.pending_choice.chooser_id;
            await emitGameStateToPlayer(
              gameNs,
              roomName,
              nextState,
              chooserId,
              { events }
            );
            await emitChoiceRequired(gameNs, roomName, gameId, nextState);

            const pauseMeta = activeGames.get(gameId);
            if (pauseMeta?.turnManager) {
              // Keep it the chooser's turn; re-arm the timer after the placement
              // animations so the existing escalation/timeout logic still fires.
              pauseMeta.turnManager.startTurn(
                chooserId,
                false,
                sumAnimationDelay(events)
              );
            }
            return;
          }

          // Broadcast events & new state to both players
          if (actionType !== "surrender") {
            await emitGameStateSanitized(gameNs, roomName, nextState, {
              events,
            });
          }

          // Timer & turn management
          const roomMeta = activeGames.get(gameId);

          if (actionType === "mulligan") {
            const transitionedToActive = nextState.status === GameStatus.ACTIVE;
            if (transitionedToActive && roomMeta) {
              if (roomMeta.mulliganTimer) {
                clearTimeout(roomMeta.mulliganTimer);
                roomMeta.mulliganTimer = null;
              }
              if (!roomMeta.turnManager) {
                roomMeta.turnManager = new TurnManager(
                  gameNs,
                  roomName,
                  nextState.current_player_id,
                  roomMeta.playerIds,
                  makeOnTurnTimeout(gameId, roomName, roomMeta)
                );
                roomMeta.turnManager.startTurn(nextState.current_player_id, true);
              }
            }
          } else if (roomMeta && roomMeta.turnManager) {
            roomMeta.turnManager.onPlayerAction(userId);

            if (nextState.status === GameStatus.COMPLETED) {
              roomMeta.turnManager.dispose();
              roomMeta.turnManager = null;
              clearActiveMatch(roomMeta.playerIds[0]);
              clearActiveMatch(roomMeta.playerIds[1]);
            } else {
              roomMeta.turnManager.startTurn(
                nextState.current_player_id,
                false,
                sumAnimationDelay(events)
              );
            }
          }

          if (nextState.status === GameStatus.COMPLETED) {
            const { hydrated_card_data_cache, ...rest } = nextState;

            // Determine if this is a forfeit (surrender) or normal completion
            const isForfeit = actionType === "surrender";
            const gameStartTime = new Date(gameRecord.created_at);
            const player1Id = gameRecord.player1_id;
            const player2Id = gameRecord.player2_id;

            // Process rewards for both players in parallel
            const rewardPromises: Promise<any>[] = [];

            // Process rewards for player 1
            rewardPromises.push(
              GameRewardsService.processGameCompletion(
                player1Id,
                nextState,
                "pvp",
                gameStartTime,
                player1Id,
                player2Id,
                gameRecord.player1_deck_id!,
                gameId,
                isForfeit
              ).catch((err) => {
                console.error(
                  `[namespace.game] Error processing rewards for player1 ${player1Id}:`,
                  err
                );
                return null;
              })
            );

            // Process rewards for player 2
            rewardPromises.push(
              GameRewardsService.processGameCompletion(
                player2Id,
                nextState,
                "pvp",
                gameStartTime,
                player1Id,
                player2Id,
                gameRecord.player2_deck_id!,
                gameId,
                isForfeit
              ).catch((err) => {
                console.error(
                  `[namespace.game] Error processing rewards for player2 ${player2Id}:`,
                  err
                );
                return null;
              })
            );

            const [player1Rewards, player2Rewards] = await Promise.all(
              rewardPromises
            );

            // Emit game end with reward info
            const sockets = await gameNs.in(roomName).fetchSockets();
            for (const s of sockets as any) {
              const viewerId: string = s.data?.user_id ?? "";
              const playerRewards =
                viewerId === player1Id ? player1Rewards : player2Rewards;

              s.emit(GameNamespaceEvent.SERVER_GAME_END, {
                result: {
                  winnerId: nextState.winner,
                  reason: isForfeit ? "surrender" : "completed",
                  gameState: rest,
                },
                rewards: playerRewards
                  ? {
                    gems: playerRewards.rewards.currency.gems,
                    cardXp: playerRewards.rewards.card_xp_rewards,
                    winStreakInfo: playerRewards.win_streak_info,
                  }
                  : null,
              });
            }
          }
        } finally {
          // Always release the lock
          releaseLock();
        }
      }
    );

    // Clean-up on disconnect.
    socket.on("disconnect", async (reason) => {
      console.log(`[/game] Disconnect – userId=${userId}: ${reason}`);

      // Remove from user-socket map only if this socket is the current one
      // (avoids removing a newer socket's entry when an old one disconnects)
      if (userGameSocketMap.get(userId) === socket.id) {
        userGameSocketMap.delete(userId);
        gameNamespaceConnectedUsers.delete(userId);
      }

      // Clean up matchmaking queue on disconnect
      const queueIndex = matchmakingQueue.findIndex((p) => p.userId === userId);
      if (queueIndex > -1) {
        matchmakingQueue.splice(queueIndex, 1);
        console.log(
          `User ${userId} removed from matchmaking queue due to disconnect`
        );
      }

      const gameId = socket.data.gameId as string | undefined;
      if (!gameId) return;

      const meta = activeGames.get(gameId);
      if (!meta) return;

      const roomName = `game:${gameId}`;

      // Check if the user has any other sockets still connected to this game room
      const roomSockets = await gameNs.in(roomName).fetchSockets();
      const userStillConnected = roomSockets.some(
        (s: any) => s.data?.user_id === userId && s.id !== socket.id
      );

      if (userStillConnected) {
        // User has another socket connected, don't start surrender timer
        console.log(
          `[/game] User ${userId} still has other sockets in game ${gameId}, skipping grace timer`
        );
        return;
      }

      // Start 15s grace timer for this user (only if not already running)
      if (meta.graceTimers.has(userId)) return; // already running

      const timer = setTimeout(async () => {
        try {
          // Before surrendering, double-check user is still disconnected
          const currentRoomSockets = await gameNs.in(roomName).fetchSockets();
          const userReconnected = currentRoomSockets.some(
            (s: any) => s.data?.user_id === userId
          );

          if (userReconnected) {
            // User reconnected during grace period
            meta.graceTimers.delete(userId);
            return;
          }

          // Treat as surrender due to disconnect timeout
          const latestRecord = await gameService.getRawGameRecord(
            gameId,
            userId
          );

          if (!latestRecord) return;

          // Don't surrender if game is already completed
          if (latestRecord.game_status !== GameStatus.ACTIVE) {
            meta.graceTimers.delete(userId);
            return;
          }

          const surrenderedState = await GameLogic.surrender(
            latestRecord.game_state,
            userId
          );

          await gameService.updateGameAfterAction(
            gameId,
            surrenderedState,
            surrenderedState.status,
            surrenderedState.winner ?? null
          );

          // Process rewards for both players (disconnect is a forfeit)
          const gameStartTime = new Date(latestRecord.created_at);
          const player1Id = latestRecord.player1_id;
          const player2Id = latestRecord.player2_id;
          const isForfeit = true; // Disconnect is always a forfeit

          const rewardPromises: Promise<any>[] = [];

          // Process rewards for player 1
          rewardPromises.push(
            GameRewardsService.processGameCompletion(
              player1Id,
              surrenderedState,
              "pvp",
              gameStartTime,
              player1Id,
              player2Id,
              latestRecord.player1_deck_id!,
              gameId,
              isForfeit
            ).catch((err) => {
              console.error(
                `[namespace.game] Error processing disconnect rewards for player1:`,
                err
              );
              return null;
            })
          );

          // Process rewards for player 2
          rewardPromises.push(
            GameRewardsService.processGameCompletion(
              player2Id,
              surrenderedState,
              "pvp",
              gameStartTime,
              player1Id,
              player2Id,
              latestRecord.player2_deck_id!,
              gameId,
              isForfeit
            ).catch((err) => {
              console.error(
                `[namespace.game] Error processing disconnect rewards for player2:`,
                err
              );
              return null;
            })
          );

          const [player1Rewards, player2Rewards] = await Promise.all(
            rewardPromises
          );

          // Emit game end with reward info to remaining connected player(s)
          const remainingSockets = await gameNs.in(roomName).fetchSockets();
          for (const s of remainingSockets as any) {
            const viewerId: string = s.data?.user_id ?? "";
            const playerRewards =
              viewerId === player1Id ? player1Rewards : player2Rewards;

            s.emit(GameNamespaceEvent.SERVER_GAME_END, {
              result: {
                winnerId: surrenderedState.winner,
                reason: "disconnect",
              },
              rewards: playerRewards
                ? {
                  gems: playerRewards.rewards.currency.gems,
                  cardXp: playerRewards.rewards.card_xp_rewards,
                  winStreakInfo: playerRewards.win_streak_info,
                }
                : null,
            });
          }

          // Cleanup turn manager & metadata
          if (meta.turnManager) meta.turnManager.dispose();
          activeGames.delete(gameId);
          clearActiveMatch(meta.playerIds[0]);
          clearActiveMatch(meta.playerIds[1]);
        } catch (err) {
          console.error("[namespace.game] surrender on disconnect error", err);
        }
      }, 15000); // 15 seconds

      meta.graceTimers.set(userId, timer);
    });
  });
}
