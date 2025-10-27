import { Namespace, Server, Socket } from "socket.io";
import { socketAuthMiddleware } from "./socket.auth.middleware";
import gameService from "../services/game.service";
import {
  AuthenticatedSocket,
  JoinGamePayload,
  ServerJoinedResponse,
  GameNamespaceEvent,
  GameActionPayload,
} from "../types/socket.types";

import { TurnManager } from "./turn.manager";
import { GameLogic, GameStatus } from "../game-engine/game.logic";
import { AILogic } from "../game-engine/ai.logic";
import { clearActiveMatch } from "../api/controllers/matchmaking.controller";
import { sanitizeGameStateForPlayer } from "../utils/sanitize";
import logger from "../utils/logger";

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
  const activeGames: Map<
    string,
    {
      playerIds: [string, string];
      turnManager: TurnManager | null;
      graceTimers: Map<string, NodeJS.Timeout>; // userId -> timeout
    }
  > = new Map();

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

  // Handle new socket connections after successful auth.
  gameNs.on("connection", (socket: Socket) => {
    const authedSocket = socket as AuthenticatedSocket;
    const userId = authedSocket.user.user_id;

    // Store userId for remote socket access
    (socket as any).data.user_id = userId;

    console.log(`[/game] Connected – userId=${userId}, socketId=${socket.id}`);

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
            `[/game] Original hydrated_card_data_cache has ${
              Object.keys(game.game_state.hydrated_card_data_cache).length
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

        // Emit confirmation back only to this socket.
        const joinResponse: ServerJoinedResponse = {
          gameState: sanitizedGameState,
          playerNumber,
        };
        socket.emit(GameNamespaceEvent.SERVER_JOINED, joinResponse);

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
        let meta = activeGames.get(gameId);
        if (!meta) {
          meta = {
            playerIds: [game.player1_id, game.player2_id],
            turnManager: null,
            graceTimers: new Map(),
          };
          activeGames.set(gameId, meta);
        }

        // If both players are present in the room, start the game (if not already)
        const room = gameNs.adapter.rooms.get(roomName);
        if (room && room.size === 2 && !meta.turnManager) {
          // Randomly select starting player
          const startingPlayer =
            Math.random() < 0.5 ? meta.playerIds[0] : meta.playerIds[1];

          meta.turnManager = new TurnManager(
            gameNs,
            roomName,
            startingPlayer,
            meta.playerIds,
            async (timedOutPlayerId) => {
              // ----------- Phase-4 AI fallback on timeout ---------------
              try {
                const ai = new AILogic();
                const latestRecord = await gameService.getRawGameRecord(
                  gameId,
                  timedOutPlayerId
                );

                if (!latestRecord) return; // game ended or inaccessible

                let currentState = latestRecord.game_state;
                let events: any[] = [];
                let aiMoveUsed = false;

                const aiMove = await ai.makeAIMove(currentState);

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
                } else {
                  // No valid placeCard — just end turn
                  const result = await GameLogic.endTurn(
                    currentState,
                    timedOutPlayerId
                  );
                  currentState = result.state;
                  events = result.events;
                }

                await gameService.updateGameAfterAction(
                  gameId,
                  currentState,
                  currentState.status,
                  currentState.winner ?? null
                );

                await emitGameStateSanitized(gameNs, roomName, currentState, {
                  events,
                  aiMove: aiMoveUsed,
                });

                if (meta!.turnManager) {
                  if (currentState.status === GameStatus.COMPLETED) {
                    meta!.turnManager.dispose();
                    meta!.turnManager = null;
                    clearActiveMatch(meta.playerIds[0]);
                    clearActiveMatch(meta.playerIds[1]);
                  } else {
                    meta!.turnManager.startTurn(currentState.current_player_id);
                  }
                }
              } catch (err) {
                console.error("[namespace.game] AI move error", err);
              }
            }
          );

          meta.turnManager.startTurn(startingPlayer);
        }
      } catch (err) {
        console.error("[namespace.game] join_game error", err);
        socket.emit("server:error", { message: "Internal server error" });
      }
    });

    socket.on(
      GameNamespaceEvent.CLIENT_ACTION,
      async (actionPayload: GameActionPayload) => {
        const { gameId, actionType, user_card_instance_id, position } =
          actionPayload;

        if (!gameId || !actionType) {
          socket.emit(GameNamespaceEvent.SERVER_ERROR, {
            message: "gameId and actionType are required",
          });
          return;
        }

        const roomName = `game:${gameId}`;

        // Fetch fresh game record
        const gameRecord = await gameService.getRawGameRecord(gameId, userId);

        if (!gameRecord) {
          socket.emit(GameNamespaceEvent.SERVER_ERROR, {
            message: "Game not found or access denied",
          });
          return;
        }

        let nextState = gameRecord.game_state;
        let events: any[] = [];

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
              position
            );
            nextState = result.state;
            events = result.events;
          } else if (actionType === "endTurn") {
            const result = await GameLogic.endTurn(nextState, userId);
            nextState = result.state;
            events = result.events;
          } else if (actionType === "surrender") {
            nextState = await GameLogic.surrender(nextState, userId);
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

        // Broadcast events & new state to both players
        if (actionType !== "surrender") {
          await emitGameStateSanitized(gameNs, roomName, nextState, { events });
        }

        // Timer & turn management
        const meta = activeGames.get(gameId);
        if (meta && meta.turnManager) {
          meta.turnManager.onPlayerAction(userId);

          if (nextState.status === GameStatus.COMPLETED) {
            meta.turnManager.dispose();
            meta.turnManager = null;
            clearActiveMatch(meta.playerIds[0]);
            clearActiveMatch(meta.playerIds[1]);
          } else {
            meta.turnManager.startTurn(nextState.current_player_id);
          }
        }

        if (nextState.status === GameStatus.COMPLETED) {
          const { hydrated_card_data_cache, ...rest } = nextState;
          gameNs.to(roomName).emit(GameNamespaceEvent.SERVER_GAME_END, {
            result: {
              winnerId: nextState.winner,
              reason: "completed",
              gameState: rest,
            },
          });
        }
      }
    );

    // Clean-up on disconnect – Phase 1 does not require advanced logic.
    socket.on("disconnect", (reason) => {
      console.log(`[/game] Disconnect – userId=${userId}: ${reason}`);

      // Optionally: handle cleanup when all sockets for a player disconnect
      // (Grace period logic – Phase-5)

      const gameId = socket.data.gameId as string | undefined;
      if (!gameId) return;

      const meta = activeGames.get(gameId);
      if (!meta) return;

      // Start 15s grace timer for this user
      if (meta.graceTimers.has(userId)) return; // already running

      const roomName = `game:${gameId}`;

      const timer = setTimeout(async () => {
        try {
          // Treat as surrender due to disconnect timeout
          const latestRecord = await gameService.getRawGameRecord(
            gameId,
            userId
          );

          if (!latestRecord) return;

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

          gameNs.to(roomName).emit(GameNamespaceEvent.SERVER_GAME_END, {
            result: {
              winnerId: surrenderedState.winner,
              reason: "disconnect",
            },
          });

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
