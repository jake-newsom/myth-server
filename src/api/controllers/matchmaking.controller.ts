import db from "../../config/db.config";
import { default as DeckModel } from "../../models/deck.model";
import { default as UserModel } from "../../models/user.model";
import { Request, Response, NextFunction } from "express";
import { Server as IoServer } from "socket.io";
import DeckService, { DeckBudgetError } from "../../services/deck.service";
import { DECK_CONFIG } from "../../config/constants";
import {
  PresenceNamespaceEvent,
  MatchmakingFoundPayload,
} from "../../types/socket.types";
import { userRoom } from "../../sockets/namespace.presence";
import ChallengeService from "../../services/challenge.service";
import MatchmakingService, {
  DeckLookupError,
} from "../../services/matchmaking.service";

// Define interfaces for queue entries and active matches
interface QueueEntry {
  userId: string;
  deckId: string;
  timestamp: Date;
}

// In-memory queue for matchmaking (replace with Redis or DB for production)
const matchmakingQueue: QueueEntry[] = []; // Stores { userId, deckId, timestamp }
const activeMatches = new Map<string, string>(); // Stores gameId by userId if they are matched

export const isUserInMatchmakingQueue = (userId: string): boolean =>
  matchmakingQueue.some((entry) => entry.userId === userId);

// Lock set to prevent race conditions when the same user sends concurrent joinQueue requests
const joinInProgress = new Set<string>();

ChallengeService.setQueueStatusResolver(isUserInMatchmakingQueue);

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

      if (ChallengeService.hasActiveChallengeLock(userId)) {
        return res.status(409).json({
          error: {
            message:
              "You have a pending challenge. Cancel it before starting another game.",
          },
        });
      }

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
        if (!playerDeck) {
          return res.status(400).json({
            error: { message: "Selected deck could not be found." },
          });
        }
        if (playerDeck.cards.length !== DECK_CONFIG.DECK_SIZE) {
          const cardCount = playerDeck.cards.length;
          const missingCount = DECK_CONFIG.DECK_SIZE - cardCount;
          const message =
            missingCount > 0
              ? `Your deck "${playerDeck.name}" is missing ${missingCount} card${
                  missingCount === 1 ? "" : "s"
                }. Decks must contain exactly ${DECK_CONFIG.DECK_SIZE} cards to start a game (currently has ${cardCount}).`
              : `Your deck "${playerDeck.name}" has too many cards. Decks must contain exactly ${DECK_CONFIG.DECK_SIZE} cards to start a game (currently has ${cardCount}).`;
          return res.status(400).json({
            error: { message },
          });
        }

        // Enforce the deck power budget before queueing.
        try {
          await DeckService.assertDeckWithinBudget(deckId, playerDeck.name);
        } catch (budgetError: any) {
          if (budgetError instanceof DeckBudgetError) {
            return res.status(400).json({
              error: { message: budgetError.message },
            });
          }
          throw budgetError;
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
             AND game_mode IN ('pvp', 'ranked_draft')
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
             -- Ranked draft counts here too: a player already in a ranked game
             -- must not be able to sit in the unranked queue at the same time.
             AND game_mode IN ('pvp', 'ranked_draft')
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
        let hasActiveMatch = activeMatches.has(userId);

        // Validate stale in-memory match entries against the DB
        if (hasActiveMatch) {
          const cachedGameId = activeMatches.get(userId)!;
          const gameCheck = await db.query(
            `SELECT game_status FROM "games" WHERE game_id = $1`,
            [cachedGameId]
          );
          const dbStatus = gameCheck.rows[0]?.game_status;
          if (!dbStatus || dbStatus !== "active") {
            console.log(
              `Clearing stale activeMatches entry for user ${userId} (game ${cachedGameId} is ${dbStatus ?? "missing"})`
            );
            clearActiveMatch(userId);
            hasActiveMatch = false;
          }
        }

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
          // The heavy lifting lives in MatchmakingService so the upcoming queue
          // matcher can create games from a scheduler tick, where there is no
          // HTTP request to hang the logic off.
          let created;
          try {
            created = await MatchmakingService.createPvpGame(
              userId,
              deckId,
              opponent.userId,
              opponent.deckId
            );
          } catch (createError) {
            if (createError instanceof DeckLookupError) {
              return res.status(400).json({
                error: { message: createError.message },
              });
            }
            throw createError;
          }

          const newGameId = created.gameId;
          const joiningUsername = created.player1Username;
          const opponentUsername = created.player2Username;

          // Store the match for both players
          activeMatches.set(userId, newGameId);
          activeMatches.set(opponent.userId, newGameId);

          // Push match-found to BOTH players over /presence. The waiting player
          // has no pending HTTP response, so the socket is their only signal;
          // the joining player also gets the HTTP body below, and receiving the
          // event as well is harmless (existing clients already handle it) but
          // means one code path notifies everyone.
          const io = req.app.get("io") as IoServer | undefined;
          if (io) {
            const presence = io.of("/presence");
            presence
              .to(userRoom(opponent.userId))
              .emit(PresenceNamespaceEvent.SERVER_MATCHMAKING_FOUND, {
                gameId: newGameId,
                opponentUsername: joiningUsername,
              } as MatchmakingFoundPayload);
            presence
              .to(userRoom(userId))
              .emit(PresenceNamespaceEvent.SERVER_MATCHMAKING_FOUND, {
                gameId: newGameId,
                opponentUsername: opponentUsername,
              } as MatchmakingFoundPayload);
          }

          // Return match information to the player who just joined the
          // queue (and therefore triggered the match).
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

        const gameDetails = await db.query(
          'SELECT player1_id, player2_id, game_status FROM "games" WHERE game_id = $1',
          [gameId]
        );

        const dbStatus = gameDetails.rows[0]?.game_status;
        if (!dbStatus || dbStatus !== "active") {
          console.log(
            `[getMatchStatus] Clearing stale activeMatches entry for user ${userId} (game ${gameId} is ${dbStatus ?? "missing"})`
          );
          clearActiveMatch(userId);
          // Fall through to queue check / idle below
        } else {
          let opponentUsername = "Opponent";
          if (gameDetails.rows.length > 0) {
            const opponentId =
              gameDetails.rows[0].player1_id === userId
                ? gameDetails.rows[0].player2_id
                : gameDetails.rows[0].player1_id;

            const opponentUser = await UserModel.findById(opponentId);
            if (opponentUser) opponentUsername = opponentUser.username;
          }

          return res.status(200).json({
            status: "matched",
            gameId: gameId,
            opponentUsername: opponentUsername,
          });
        }
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
