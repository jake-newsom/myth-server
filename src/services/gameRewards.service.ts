import UserModel from "../models/user.model";
import XpService from "./xp.service";
import { XpReward } from "../types/service.types";
import { GameState } from "../types/game.types";
import db from "../config/db.config";
import LeaderboardService from "./leaderboard.service";
import AchievementService from "./achievement.service";

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
  calculateCurrencyRewards(
    userId: string,
    winnerId: string | null,
    gameMode: "solo" | "pvp",
    gameDurationSeconds: number
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
      }
    } else if (winnerId === null) {
      // Tie/draw rewards (smaller participation reward)
      gemsReward = gameMode === "solo" ? 2 : 3;
    } else {
      // Loss rewards (small participation reward)
      gemsReward = gameMode === "solo" ? 1 : 2;
    }

    return {
      gems: gemsReward,
    };
  },

  // Calculate XP rewards for individual cards used in the game
  calculateCardXpRewards(
    userId: string,
    winnerId: string | null,
    gameMode: "solo" | "pvp",
    playerDeckCards: { card_id: string; card_name: string }[]
  ): { card_id: string; card_name: string; xp_gained: number }[] {
    const xpRewards = [];

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
      SELECT uoc.user_card_instance_id as card_id, c.name as card_name
      FROM "deck_cards" dc
      JOIN "user_owned_cards" uoc ON dc.user_card_instance_id = uoc.user_card_instance_id
      JOIN "cards" c ON uoc.card_id = c.card_id
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
  async processGameCompletion(
    userId: string,
    gameState: GameState,
    gameMode: "solo" | "pvp",
    gameStartTime: Date,
    player1Id: string,
    player2Id: string,
    playerDeckId: string,
    gameId?: string
  ): Promise<GameCompletionResult> {
    try {
      // Calculate game result
      const gameResult = this.calculateGameResult(
        gameState,
        gameStartTime,
        player1Id,
        player2Id
      );

      // Calculate currency rewards
      const currencyRewards = this.calculateCurrencyRewards(
        userId,
        gameResult.winner,
        gameMode,
        gameResult.game_duration_seconds
      );

      // Get cards that were actually used in the game
      const usedCards = this.getCardsUsedInGame(gameState, userId);

      // Calculate XP rewards
      const cardXpRewards = this.calculateCardXpRewards(
        userId,
        gameResult.winner,
        gameMode,
        usedCards
      );

      // Award gems only (game rewards don't include gold or fate coins)
      if (currencyRewards.gems > 0) {
        await UserModel.updateGems(userId, currencyRewards.gems);
      }

      // Award XP directly to individual cards
      const xpResults = await XpService.awardDirectCardXp(
        userId,
        cardXpRewards
      );

      // Update leaderboard rankings for PvP games
      if (gameMode === "pvp" && gameId && player1Id !== player2Id) {
        try {
          await LeaderboardService.processGameCompletion(
            gameId,
            player1Id,
            player2Id,
            gameResult.winner,
            gameMode,
            gameResult.game_duration_seconds
          );
        } catch (error) {
          console.error("Error updating leaderboard rankings:", error);
          // Don't fail the entire reward process if leaderboard update fails
        }
      }

      // Trigger achievement events (temporarily disabled due to database type issue)
      try {
        // TODO: Fix achievement database type issue before re-enabling
        console.log("Achievement processing temporarily disabled");
        // Game completion event (for all players)
        // await AchievementService.triggerAchievementEvent({
        //   userId,
        //   eventType: "game_completion",
        //   eventData: {
        //     gameMode,
        //     winnerId: gameResult.winner,
        //     gameDurationSeconds: gameResult.game_duration_seconds,
        //     cardsUsed: usedCards,
        //   },
        // });

        // Game victory event (only for winner)
        // if (gameResult.winner === userId) {
        //   await AchievementService.triggerAchievementEvent({
        //     userId,
        //     eventType: "game_victory",
        //     eventData: {
        //       gameMode,
        //       isWinStreak: false, // TODO: Implement win streak tracking
        //       winStreakCount: 0, // TODO: Implement win streak tracking
        //       cardsLost: 0, // TODO: Calculate cards lost for perfect game achievement
        //       gameDurationSeconds: gameResult.game_duration_seconds,
        //     },
        //   });
        // }
      } catch (error) {
        console.error("Error processing achievement events:", error);
        // Don't fail the entire reward process if achievement processing fails
      }

      // Get updated user currencies
      const updatedUser = await UserModel.findById(userId);

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
      };
    }
  },
};

export default GameRewardsService;
