import UserModel from "../models/user.model";
import XpService from "./xp.service";
import { XpReward } from "../types/service.types";
import { GameState } from "../types/game.types";
import db from "../config/db.config";
import LeaderboardService from "./leaderboard.service";
import AchievementService from "./achievement.service";
import DailyTaskService from "./dailyTask.service";

export interface GameResult {
  winner: string | null;
  final_scores: { player1: number; player2: number };
  game_duration_seconds: number;
}

export interface CurrencyRewards {
  gems: number;
}

export interface GameRewards {
  currency: CurrencyRewards;
  card_xp_rewards: XpReward[];
}

export interface GameCompletionResult {
  game_result: GameResult;
  rewards: GameRewards;
  updated_currencies: {
    gems: number;
    total_xp: number;
  };
  win_streak_info?: {
    multiplier_applied: number;
    new_multiplier: number;
  };
}

const GameRewardsService = {
  // Calculate game result statistics
  calculateGameResult(
    gameState: GameState,
    gameStartTime: Date,
    player1Id: string,
    player2Id: string
  ): GameResult {
    const gameEndTime = new Date();
    const gameDurationMs = gameEndTime.getTime() - gameStartTime.getTime();
    const gameDurationSeconds = Math.floor(gameDurationMs / 1000);

    // Calculate scores based on controlled tiles
    let player1Score = 0;
    let player2Score = 0;

    for (let x = 0; x < 4; x++) {
      for (let y = 0; y < 4; y++) {
        const tile = gameState.board[x][y];
        if (tile && tile.card) {
          // Count cards controlled by each player
          const cardOwnerId = tile.card.owner;
          if (cardOwnerId === player1Id) {
            player1Score++;
          } else if (cardOwnerId === player2Id) {
            player2Score++;
          }
        }
      }
    }

    return {
      winner: gameState.winner,
      final_scores: { player1: player1Score, player2: player2Score },
      game_duration_seconds: gameDurationSeconds,
    };
  },

  // Calculate currency rewards based on game outcome
  // Game rewards only include gems (no gold, no fate coins)
  // isForfeit: true if game ended via surrender/disconnect (loser gets nothing)
  calculateCurrencyRewards(
    userId: string,
    winnerId: string | null,
    gameMode: "solo" | "pvp",
    gameDurationSeconds: number,
    winStreakMultiplier: number = 1.0,
    isForfeit: boolean = false
  ): CurrencyRewards {
    let gemsReward = 0;

    if (winnerId === userId) {
      // Victory rewards - gems only
      if (gameMode === "solo") {
        // Base gem reward for solo victory
        gemsReward = 5;
        // Bonus for quick victory (under 3 minutes)
        if (gameDurationSeconds < 180) {
          gemsReward += 2;
        }
      } else if (gameMode === "pvp") {
        // Higher gem reward for PvP victory
        gemsReward = 10;
        // Bonus for quick victory
        if (gameDurationSeconds < 180) {
          gemsReward += 3;
        }
        // Apply win streak multiplier for PvP games only
        gemsReward = Math.floor(gemsReward * winStreakMultiplier);
      }
    } else if (winnerId === null) {
      // Tie/draw rewards (smaller participation reward)
      gemsReward = gameMode === "solo" ? 2 : 3;
      // Apply win streak multiplier for PvP draws as well
      if (gameMode === "pvp") {
        gemsReward = Math.floor(gemsReward * winStreakMultiplier);
      }
    } else {
      // Loss rewards
      if (isForfeit) {
        // Forfeit (surrender/disconnect): loser gets nothing
        gemsReward = 0;
      } else {
        // Normal completion: loser gets participation reward
        gemsReward = gameMode === "solo" ? 1 : 5;
      }
      // No multiplier applied to losses
    }

    return {
      gems: gemsReward,
    };
  },

  // Calculate XP rewards for individual cards used in the game
  // isForfeit: true if game ended via surrender/disconnect (loser gets no XP)
  calculateCardXpRewards(
    userId: string,
    winnerId: string | null,
    gameMode: "solo" | "pvp",
    playerDeckCards: { card_id: string; card_name: string }[],
    isForfeit: boolean = false
  ): { card_id: string; card_name: string; xp_gained: number }[] {
    const xpRewards = [];

    // If this is a forfeit and user is the loser, no XP
    if (isForfeit && winnerId !== userId && winnerId !== null) {
      return [];
    }

    for (const card of playerDeckCards) {
      let baseXp = 20; // Base XP for cards used in games

      // Victory bonus
      if (winnerId === userId) {
        baseXp += 5; // Extra 5 XP if player wins
      }

      xpRewards.push({
        card_id: card.card_id,
        card_name: card.card_name,
        xp_gained: baseXp,
      });
    }

    return xpRewards;
  },

  // Get player's deck cards for XP calculation
  async getPlayerDeckCards(
    deckId: string
  ): Promise<{ card_id: string; card_name: string }[]> {
    const query = `
      SELECT uoc.user_card_instance_id as card_id, ch.name as card_name
      FROM "deck_cards" dc
      JOIN "user_owned_cards" uoc ON dc.user_card_instance_id = uoc.user_card_instance_id
      JOIN "card_variants" cv ON uoc.card_variant_id = cv.card_variant_id
      JOIN "characters" ch ON cv.character_id = ch.character_id
      WHERE dc.deck_id = $1
    `;

    const { rows } = await db.query(query, [deckId]);
    return rows;
  },

  // Get cards that were actually used by a player during the game
  getCardsUsedInGame(
    gameState: GameState,
    playerId: string
  ): { card_id: string; card_name: string }[] {
    const usedCards: { card_id: string; card_name: string }[] = [];
    const seenCardIds = new Set<string>();

    // Get cards from the board that were originally owned by this player
    for (let x = 0; x < 4; x++) {
      for (let y = 0; y < 4; y++) {
        const tile = gameState.board[x][y];
        if (tile && tile.card && tile.card.original_owner === playerId) {
          const cardId = tile.card.user_card_instance_id;
          if (!seenCardIds.has(cardId)) {
            seenCardIds.add(cardId);
            usedCards.push({
              card_id: cardId,
              card_name: tile.card.base_card_data.name,
            });
          }
        }
      }
    }

    // Get cards from the player's discard pile
    const player =
      playerId === gameState.player1.user_id
        ? gameState.player1
        : gameState.player2;
    for (const cardId of player.discard_pile) {
      if (!seenCardIds.has(cardId)) {
        const cardData = gameState.hydrated_card_data_cache?.[cardId];
        if (cardData) {
          seenCardIds.add(cardId);
          usedCards.push({
            card_id: cardId,
            card_name: cardData.base_card_data.name,
          });
        }
      }
    }

    return usedCards;
  },

  // Main method to process game completion and award rewards
  // Optimized to parallelize independent operations for faster response times
  // isForfeit: true if game ended via surrender/disconnect (loser gets nothing)
  async processGameCompletion(
    userId: string,
    gameState: GameState,
    gameMode: "solo" | "pvp",
    gameStartTime: Date,
    player1Id: string,
    player2Id: string,
    playerDeckId: string,
    gameId?: string,
    isForfeit: boolean = false
  ): Promise<GameCompletionResult> {
    try {
      // === PHASE 1: Sequential calculations (sync, no DB) ===
      const gameResult = this.calculateGameResult(
        gameState,
        gameStartTime,
        player1Id,
        player2Id
      );

      // Get cards that were actually used in the game (sync)
      const usedCards = this.getCardsUsedInGame(gameState, userId);

      // === PHASE 2: Get win streak multiplier (needed for reward calculation) ===
      let winStreakMultiplier = 1.0;
      if (gameMode === "pvp") {
        winStreakMultiplier = await UserModel.getWinStreakMultiplier(userId);
      }

      // Calculate currency rewards (sync, depends on multiplier)
      const currencyRewards = this.calculateCurrencyRewards(
        userId,
        gameResult.winner,
        gameMode,
        gameResult.game_duration_seconds,
        winStreakMultiplier,
        isForfeit
      );

      // Calculate XP rewards (sync)
      const cardXpRewards = this.calculateCardXpRewards(
        userId,
        gameResult.winner,
        gameMode,
        usedCards,
        isForfeit
      );

      // === PHASE 3: Award core rewards (must complete before response) ===
      // These operations modify user data and must complete

      // Parallelize win streak update and gem award
      const coreRewardPromises: Promise<any>[] = [];

      if (currencyRewards.gems > 0) {
        coreRewardPromises.push(UserModel.updateGems(userId, currencyRewards.gems));
      }

      // Update win streak multiplier for PvP games only
      if (gameMode === "pvp" && player1Id !== player2Id) {
        if (gameResult.winner === userId) {
          coreRewardPromises.push(UserModel.incrementWinStreakMultiplier(userId));
        } else if (gameResult.winner !== null && gameResult.winner !== userId) {
          coreRewardPromises.push(UserModel.resetWinStreakMultiplier(userId));
        }
      }

      // Award XP directly to individual cards (this is now batched internally)
      coreRewardPromises.push(
        XpService.awardDirectCardXp(userId, cardXpRewards)
      );

      // Wait for core rewards to complete
      const coreResults = await Promise.all(coreRewardPromises);

      // Extract XP results (last item in the array)
      const xpResults = coreResults[coreResults.length - 1] as XpReward[];

      // === PHASE 4: Parallel non-blocking operations ===
      // These operations don't affect the response data and can run in parallel
      const parallelOps: Promise<any>[] = [];

      // Leaderboard update (PvP only)
      if (gameMode === "pvp" && gameId && player1Id !== player2Id) {
        parallelOps.push(
          LeaderboardService.processGameCompletion(
            gameId,
            player1Id,
            player2Id,
            gameResult.winner,
            gameMode,
            gameResult.game_duration_seconds
          ).catch((error) => {
            console.error("Error updating leaderboard rankings:", error);
          })
        );
      }

      // Game completion achievement (always)
      parallelOps.push(
        AchievementService.triggerAchievementEvent({
          userId,
          eventType: "game_completion",
          eventData: {
            gameMode,
            winnerId: gameResult.winner,
            gameDurationSeconds: gameResult.game_duration_seconds,
            cardsUsed: usedCards,
          },
        }).catch((error) => {
          console.error("Error processing game_completion achievement:", error);
        })
      );

      // Game victory achievement and daily task (winners only)
      if (gameResult.winner === userId) {
        const winnerScore =
          gameResult.winner === player1Id
            ? gameResult.final_scores.player1
            : gameResult.final_scores.player2;
        const loserScore =
          gameResult.winner === player1Id
            ? gameResult.final_scores.player2
            : gameResult.final_scores.player1;

        parallelOps.push(
          AchievementService.triggerAchievementEvent({
            userId,
            eventType: "game_victory",
            eventData: {
              gameMode,
              isWinStreak: false,
              winStreakCount: 0,
              winnerScore,
              loserScore,
              gameDurationSeconds: gameResult.game_duration_seconds,
            },
          }).catch((error) => {
            console.error("Error processing game_victory achievement:", error);
          })
        );

        parallelOps.push(
          DailyTaskService.trackWin(userId).catch((error) => {
            console.error("Error tracking win for daily task:", error);
          })
        );
      }

      // Get updated user currencies (needed for response)
      parallelOps.push(UserModel.findById(userId));

      // Wait for all parallel operations
      const parallelResults = await Promise.all(parallelOps);

      // Extract updated user (last item in the array)
      const updatedUser = parallelResults[parallelResults.length - 1];

      // Prepare win streak info for PvP games
      let winStreakInfo = undefined;
      if (gameMode === "pvp") {
        winStreakInfo = {
          multiplier_applied: winStreakMultiplier,
          new_multiplier: updatedUser?.win_streak_multiplier || 1.0,
        };
      }

      return {
        game_result: gameResult,
        rewards: {
          currency: currencyRewards,
          card_xp_rewards: xpResults,
        },
        updated_currencies: {
          gems: updatedUser?.gems || 0,
          total_xp: updatedUser?.total_xp || 0,
        },
        win_streak_info: winStreakInfo,
      };
    } catch (error) {
      console.error("Error processing game completion rewards:", error);

      // Return minimal result if reward processing fails
      const gameResult = this.calculateGameResult(
        gameState,
        gameStartTime,
        player1Id,
        player2Id
      );

      return {
        game_result: gameResult,
        rewards: {
          currency: { gems: 0 },
          card_xp_rewards: [],
        },
        updated_currencies: {
          gems: 0,
          total_xp: 0,
        },
        win_streak_info: undefined,
      };
    }
  },
};

export default GameRewardsService;
