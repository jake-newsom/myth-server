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
} from "../types/socket.types";

import { TurnManager } from "./turn.manager";
import { GameLogic, GameStatus } from "../game-engine/game.logic";
import { AILogic } from "../game-engine/ai.logic";
import {
  clearActiveMatch,
  matchmakingQueue,
} from "../api/controllers/matchmaking.controller";
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
      actionLock: Promise<void>; // mutex for serializing actions
    }
  > = new Map();

  /**
   * Acquire a per-game lock to serialize action processing.
   * Returns a release function that must be called when done.
   */
  function acquireActionLock(gameId: string): Promise<() => void> {
    const meta = activeGames.get(gameId);
    if (!meta) {
      // No game metadata, return a no-op lock
      return Promise.resolve(() => {});
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
            actionLock: Promise.resolve(), // Initialize with resolved promise
          };
          activeGames.set(gameId, meta);
        }

        // If both players are present in the room, start the game (if not already)
        const room = gameNs.adapter.rooms.get(roomName);
        if (room && room.size === 2 && !meta.turnManager) {
          // Use the current_player_id from the persisted game state (set during game creation)
          const startingPlayer = game.game_state.current_player_id;

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

                // Pass the timed-out player's ID so AI uses their hand, not the opponent's
                const aiMove = await ai.makeAIMove(
                  currentState,
                  "medium",
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

          // First turn of the game - start immediately (no animation delay)
          meta.turnManager.startTurn(startingPlayer, true);
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

          // Validate that the game is still active
          if (gameRecord.game_status !== GameStatus.ACTIVE) {
            socket.emit(GameNamespaceEvent.SERVER_ERROR, {
              message: `Game is not active (status: ${gameRecord.game_status})`,
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
            await emitGameStateSanitized(gameNs, roomName, nextState, {
              events,
            });
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
                gameRecord.player1_deck_id,
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
                gameRecord.player2_deck_id,
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
              latestRecord.player1_deck_id,
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
              latestRecord.player2_deck_id,
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
