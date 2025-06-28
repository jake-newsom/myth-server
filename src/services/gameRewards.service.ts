import UserModel from "../models/user.model";
import XpService, { XpReward } from "./xp.service";
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
  gold: number;
  gems: number;
  fate_coins: number;
}

export interface GameRewards {
  currency: CurrencyRewards;
  card_xp_rewards: XpReward[];
}

export interface GameCompletionResult {
  game_result: GameResult;
  rewards: GameRewards;
  updated_currencies: {
    gold: number;
    gems: number;
    fate_coins: number;
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
  calculateCurrencyRewards(
    userId: string,
    winnerId: string | null,
    gameMode: "solo" | "pvp",
    gameDurationSeconds: number
  ): CurrencyRewards {
    let goldReward = 0;
    let gemsReward = 0;
    let wonderCoinsReward = 0;

    if (winnerId === userId) {
      // Victory rewards
      if (gameMode === "solo") {
        goldReward = 50; // Base solo victory reward
        wonderCoinsReward = 1; // 1 wonder coin for solo victory
        // Bonus for quick victory (under 3 minutes)
        if (gameDurationSeconds < 180) {
          goldReward += 10;
          wonderCoinsReward += 1; // Extra wonder coin for quick victory
        }
        // 5% chance for gem reward on solo victory
        if (Math.random() < 0.05) {
          gemsReward = 1;
        }
      } else if (gameMode === "pvp") {
        goldReward = 75; // Higher reward for PvP victory
        wonderCoinsReward = 2; // 2 wonder coins for PvP victory
        // 10% chance for gem reward on PvP victory
        if (Math.random() < 0.1) {
          gemsReward = 2;
        }
      }
    } else if (winnerId === null) {
      // Tie/draw rewards (smaller participation reward)
      goldReward = gameMode === "solo" ? 15 : 25;
      wonderCoinsReward = 1; // 1 wonder coin for ties
    } else {
      // Loss rewards (small participation reward)
      goldReward = gameMode === "solo" ? 10 : 20;
      // No wonder coins for losses (encourages winning)
    }

    return {
      gold: goldReward,
      gems: gemsReward,
      fate_coins: wonderCoinsReward,
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
      let baseXp = 5; // Base XP for participation

      // Victory bonus
      if (winnerId === userId) {
        baseXp += gameMode === "solo" ? 15 : 25; // 20 total for solo win, 30 for pvp win
      } else if (winnerId === null) {
        baseXp += 5; // Small bonus for tie
      }

      // Add some randomness (±2 XP)
      const randomBonus = Math.floor(Math.random() * 5) - 2;
      const finalXp = Math.max(1, baseXp + randomBonus); // Minimum 1 XP

      xpRewards.push({
        card_id: card.card_id,
        card_name: card.card_name,
        xp_gained: finalXp,
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

      // Get player's deck cards
      const deckCards = await this.getPlayerDeckCards(playerDeckId);

      // Calculate XP rewards
      const cardXpRewards = this.calculateCardXpRewards(
        userId,
        gameResult.winner,
        gameMode,
        deckCards
      );

      // Award currency
      await UserModel.updateBothCurrencies(
        userId,
        currencyRewards.gold,
        currencyRewards.gems
      );

      // Award wonder coins if any
      if (currencyRewards.fate_coins > 0) {
        await UserModel.updateFateCoins(userId, currencyRewards.fate_coins);
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
        //     cardsUsed: deckCards,
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
          gold: updatedUser?.gold || 0,
          gems: updatedUser?.gems || 0,
          fate_coins: updatedUser?.fate_coins || 0,
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
          currency: { gold: 0, gems: 0, fate_coins: 0 },
          card_xp_rewards: [],
        },
        updated_currencies: {
          gold: 0,
          gems: 0,
          fate_coins: 0,
          total_xp: 0,
        },
      };
    }
  },
};

export default GameRewardsService;
