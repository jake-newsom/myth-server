import db from "../../config/db.config";
import { default as DeckModel } from "../../models/deck.model";
import { default as UserModel } from "../../models/user.model";
import { GameLogic } from "../../game-engine/game.logic";
import { v4 as uuidv4 } from "uuid";
import { Request, Response, NextFunction } from "express";
import { GameState } from "../../types/game.types";
import DeckService from "../../services/deck.service";

// Define interfaces for queue entries and active matches
interface QueueEntry {
  userId: string;
  deckId: string;
  timestamp: Date;
}

// In-memory queue for matchmaking (replace with Redis or DB for production)
const matchmakingQueue: QueueEntry[] = []; // Stores { userId, deckId, timestamp }
const activeMatches = new Map<string, string>(); // Stores gameId by userId if they are matched

// Lock set to prevent race conditions when the same user sends concurrent joinQueue requests
const joinInProgress = new Set<string>();

// --- Match Cleanup Function ---
function clearActiveMatch(userId: string) {
  if (activeMatches.has(userId)) {
    activeMatches.delete(userId);
    console.log(`User ${userId} cleared from activeMatches.`);
  }
}

/**
 * Matchmaking controller for PvP game matchmaking.
 * Provides endpoints for joining/leaving matchmaking queue and checking status.
 */
const MatchmakingController = {
  /**
   * Join the matchmaking queue
   * @param {Request} req - Express request object
   * @param {Response} res - Express response object
   * @param {NextFunction} next - Express next middleware function
   */
  async joinQueue(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user.user_id;
      const { deckId } = req.body;

      if (!deckId) {
        return res.status(400).json({
          error: { message: "deckId is required to join matchmaking." },
        });
      }

      // --- Atomic guard: prevent race condition from concurrent requests by the same user ---
      if (joinInProgress.has(userId)) {
        return res.status(429).json({
          error: { message: "Matchmaking request already in progress. Please wait." },
        });
      }
      joinInProgress.add(userId);

      try {
        // Validate deck ownership and validity
        const playerDeck = await DeckModel.findDeckWithInstanceDetails(
          deckId,
          userId
        );
        if (!playerDeck || playerDeck.cards.length < 10) {
          // Min deck size requirement
          return res.status(400).json({
            error: { message: "Invalid or incomplete deck selected." },
          });
        }

        // --- Database-level active game check (survives server restarts) ---
        // Only consider games created within the last 2 hours as legitimately active.
        // Older "active" games are stale (crashed sessions, abandoned games) and get
        // auto-aborted so they don't block matchmaking forever.
        const STALE_GAME_THRESHOLD = "2 hours";

        // Auto-abort stale active PvP games for this user
        const abortedResult = await db.query(
          `UPDATE "games"
           SET game_status = 'aborted', completed_at = NOW()
           WHERE (player1_id = $1 OR player2_id = $1)
             AND game_status = 'active'
             AND game_mode = 'pvp'
             AND created_at < NOW() - INTERVAL '${STALE_GAME_THRESHOLD}'
           RETURNING game_id`,
          [userId]
        );
        if (abortedResult.rowCount && abortedResult.rowCount > 0) {
          console.log(
            `Auto-aborted ${abortedResult.rowCount} stale game(s) for user ${userId}: ${abortedResult.rows.map((r: any) => r.game_id).join(", ")}`
          );
          // Clean up in-memory state for aborted games
          for (const row of abortedResult.rows) {
            clearActiveMatch(userId);
          }
        }

        // Now check for legitimately active recent PvP games
        // Solo/tower games should not block online matchmaking
        const activeGameResult = await db.query(
          `SELECT game_id FROM "games"
           WHERE (player1_id = $1 OR player2_id = $1)
             AND game_status = 'active'
             AND game_mode = 'pvp'
           LIMIT 1`,
          [userId]
        );
        if (activeGameResult.rows.length > 0) {
          const existingGameId = activeGameResult.rows[0].game_id;
          // Sync the in-memory map
          activeMatches.set(userId, existingGameId);
          return res.status(409).json({
            error: {
              message: "You already have an active game in progress.",
              code: "ACTIVE_GAME_EXISTS",
            },
            gameId: existingGameId,
          });
        }

        // Prevent joining if already in queue or an active match (in-memory check)
        const existingQueueEntry = matchmakingQueue.find(
          (p) => p.userId === userId
        );
        const hasActiveMatch = activeMatches.has(userId);

        if (existingQueueEntry || hasActiveMatch) {
          // If already matched, return existing gameId
          if (hasActiveMatch) {
            return res.status(200).json({
              status: "matched",
              gameId: activeMatches.get(userId),
            });
          }

          // If in queue, check if entry is stale (older than 5 minutes)
          if (existingQueueEntry) {
            const now = new Date();
            const entryAge =
              now.getTime() - existingQueueEntry.timestamp.getTime();
            const staleThreshold = 5 * 60 * 1000; // 5 minutes

            if (entryAge > staleThreshold) {
              // Remove stale entry and allow rejoin
              const index = matchmakingQueue.findIndex(
                (p) => p.userId === userId
              );
              if (index > -1) {
                matchmakingQueue.splice(index, 1);
                console.log(
                  `Removed stale queue entry for user ${userId}, age: ${Math.floor(
                    entryAge / 1000
                  )}s`
                );
              }
            } else {
              // Entry is fresh, user is legitimately in queue
              return res.status(400).json({
                error: { message: "Already in queue or an active match." },
              });
            }
          }
        }

        // Check if there's someone else waiting in the queue
        if (matchmakingQueue.length > 0) {
          const opponent = matchmakingQueue.shift(); // Get first player from queue

          if (!opponent) {
            // TypeScript safety check
            return res.status(500).json({
              error: { message: "Error processing matchmaking queue." },
            });
          }

          if (opponent.userId === userId) {
            // Safeguard against matching with self
            matchmakingQueue.push(opponent);
            return res.status(202).json({
              status: "queued",
              message: "Waiting for an opponent.",
            });
          }

          // --- Create Game ---
          const player1Deck = await DeckModel.findDeckWithInstanceDetails(
            deckId,
            userId
          );
          const player2Deck = await DeckModel.findDeckWithInstanceDetails(
            opponent.deckId,
            opponent.userId
          );

          if (!player1Deck || !player2Deck) {
            return res.status(400).json({
              error: { message: "Error retrieving deck information." },
            });
          }

          // Extract card IDs for the game initialization
          const p1DeckCardIds = player1Deck.cards.reduce(
            (acc: string[], card) => {
              // Each card in the deck is an instance, so we add it once
              if (card.user_card_instance_id) {
                acc.push(card.user_card_instance_id);
              }
              return acc;
            },
            []
          );

          const p2DeckCardIds = player2Deck.cards.reduce(
            (acc: string[], card) => {
              // Each card in the deck is an instance, so we add it once
              if (card.user_card_instance_id) {
                acc.push(card.user_card_instance_id);
              }
              return acc;
            },
            []
          );

          // Initialize game with the current player as P1, queued player as P2
          const p1UserIdForGame = userId;
          const p2UserIdForGame = opponent.userId;

          const initialGameState = await GameLogic.initializeGame(
            p1DeckCardIds,
            p2DeckCardIds,
            p1UserIdForGame,
            p2UserIdForGame
          );

          // Player who initiated match often goes first
          initialGameState.current_player_id = p1UserIdForGame;

          // Attach deck effects based on mythology composition
          const [p1DeckEffect, p2DeckEffect] = await Promise.all([
            DeckService.getDeckEffect(deckId),
            DeckService.getDeckEffect(opponent.deckId),
          ]);

          if (p1DeckEffect) {
            initialGameState.player1.deck_effect = p1DeckEffect;
            initialGameState.player1.deck_effect_state = { last_triggered_round: 0 };
          }
          if (p2DeckEffect) {
            initialGameState.player2.deck_effect = p2DeckEffect;
            initialGameState.player2.deck_effect_state = { last_triggered_round: 0 };
          }

          // Create a new game in the database
          const gameQuery = `
            INSERT INTO "games" (player1_id, player2_id, player1_deck_id, player2_deck_id, game_mode, game_status, board_layout, game_state, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            RETURNING game_id;
          `;
          const gameValues = [
            p1UserIdForGame,
            p2UserIdForGame,
            deckId,
            opponent.deckId,
            "pvp",
            "active",
            "4x4",
            JSON.stringify(initialGameState),
          ];

          const gameResult = await db.query(gameQuery, gameValues);
          const newGameId = gameResult.rows[0].game_id;

          // Store the match for both players
          activeMatches.set(userId, newGameId);
          activeMatches.set(opponent.userId, newGameId);

          // Get opponent username for response
          const opponentUser = await UserModel.findById(opponent.userId);
          const opponentUsername = opponentUser
            ? opponentUser.username
            : "Opponent";

          // Return match information to the player
          res.status(200).json({
            status: "matched",
            gameId: newGameId,
            opponentUsername: opponentUsername,
          });
        } else {
          // No opponent available, add to queue and wait
          matchmakingQueue.push({
            userId,
            deckId,
            timestamp: new Date(),
          });

          res.status(202).json({
            status: "queued",
            message: "Added to queue. Waiting for an opponent.",
          });
        }
      } finally {
        // Always release the atomic guard
        joinInProgress.delete(userId);
      }
    } catch (error) {
      console.error("Matchmaking error:", error);
      next(error);
    }
  },

  /**
   * Get current matchmaking status
   * @param {Request} req - Express request object
   * @param {Response} res - Express response object
   * @param {NextFunction} next - Express next middleware function
   */
  async getMatchStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user.user_id;

      // Check if user is in an active match
      if (activeMatches.has(userId)) {
        const gameId = activeMatches.get(userId);

        // Get opponent details
        const gameDetails = await db.query(
          'SELECT player1_id, player2_id FROM "games" WHERE game_id = $1',
          [gameId]
        );

        let opponentUsername = "Opponent";
        if (gameDetails.rows.length > 0) {
          const opponentId =
            gameDetails.rows[0].player1_id === userId
              ? gameDetails.rows[0].player2_id
              : gameDetails.rows[0].player1_id;

          const opponentUser = await UserModel.findById(opponentId);
          if (opponentUser) opponentUsername = opponentUser.username;
        }

        res.status(200).json({
          status: "matched",
          gameId: gameId,
          opponentUsername: opponentUsername,
        });
      }
      // Check if user is in queue
      else if (matchmakingQueue.find((p) => p.userId === userId)) {
        // Calculate wait time
        const queueEntry = matchmakingQueue.find((p) => p.userId === userId);
        if (!queueEntry) {
          return res.status(500).json({
            error: { message: "Error retrieving queue status." },
          });
        }

        const waitTimeSeconds = Math.floor(
          (new Date().getTime() - queueEntry.timestamp.getTime()) / 1000
        );

        res.status(200).json({
          status: "queued",
          message: "Still in queue. Waiting for an opponent.",
          waitTime: waitTimeSeconds,
          queuePosition:
            matchmakingQueue.findIndex((p) => p.userId === userId) + 1,
          queueLength: matchmakingQueue.length,
        });
      }
      // User is not in queue or match
      else {
        res.status(200).json({
          status: "idle",
          message: "Not in queue or any active match.",
        });
      }
    } catch (error) {
      console.error("Matchmaking status error:", error);
      next(error);
    }
  },

  /**
   * Leave the matchmaking queue
   * @param {Request} req - Express request object
   * @param {Response} res - Express response object
   * @param {NextFunction} next - Express next middleware function
   */
  async leaveQueue(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user.user_id;
      const index = matchmakingQueue.findIndex((p) => p.userId === userId);

      if (index > -1) {
        matchmakingQueue.splice(index, 1);
        res.status(200).json({
          status: "left_queue",
          message: "Removed from matchmaking queue.",
        });
      } else {
        // Can't leave queue if already matched or not in queue
        if (activeMatches.has(userId)) {
          return res.status(400).json({
            error: {
              message: "Already matched with an opponent. Cannot leave queue.",
            },
          });
        }

        res.status(400).json({
          error: { message: "You are not in the matchmaking queue." },
        });
      }
    } catch (error) {
      console.error("Leave queue error:", error);
      next(error);
    }
  },
};

export { MatchmakingController, clearActiveMatch, matchmakingQueue };
