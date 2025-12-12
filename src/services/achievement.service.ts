import AchievementModel from "../models/achievement.model";
import UserModel from "../models/user.model";
import {
  Achievement,
  UserAchievementWithDetails,
} from "../types/database.types";
import { RarityUtils } from "../types/card.types";

interface AchievementProgressEvent {
  userId: string;
  eventType: string;
  eventData?: any;
}

interface AchievementCompletionResult {
  newlyCompleted: UserAchievementWithDetails[];
  updatedProgress: UserAchievementWithDetails[];
}

interface ClaimRewardsResult {
  success: boolean;
  claimedAchievements: UserAchievementWithDetails[];
  totalRewards: {
    gems: number;
    fate_coins: number;
    packs: number;
    card_fragments: number;
  };
  updatedCurrencies?: {
    gems: number;
    fate_coins: number;
    pack_count: number;
    card_fragments: number;
    total_xp: number;
  };
}

const AchievementService = {
  /**
   * Get all achievements for a user with their progress
   */
  async getUserAchievements(
    userId: string,
    category?: string,
    completedOnly: boolean = false,
    unclaimedOnly: boolean = false,
    includeLocked: boolean = false
  ): Promise<{
    success: boolean;
    achievements: UserAchievementWithDetails[];
    stats: any;
  }> {
    try {
      const [achievements, stats] = await Promise.all([
        AchievementModel.getAllUserAchievements(
          userId,
          category,
          includeLocked
        ),
        AchievementModel.getUserAchievementStats(userId),
      ]);

      // Filter based on parameters
      let filteredAchievements = achievements;

      if (completedOnly) {
        filteredAchievements = filteredAchievements.filter(
          (a) => a.is_completed
        );
      }

      if (unclaimedOnly) {
        filteredAchievements = filteredAchievements.filter((a) => a.can_claim);
      }

      return {
        success: true,
        achievements: filteredAchievements,
        stats,
      };
    } catch (error) {
      console.error("Error fetching user achievements:", error);
      return {
        success: false,
        achievements: [],
        stats: {
          total_achievements: 0,
          completed_achievements: 0,
          claimed_achievements: 0,
          completion_percentage: 0,
          total_rewards_earned: {
            gems: 0,
            fate_coins: 0,
            packs: 0,
            card_fragments: 0,
          },
          achievements_by_category: {},
          achievements_by_rarity: {},
        },
      };
    }
  },

  /**
   * Get achievement categories with counts
   */
  async getAchievementCategories(): Promise<{
    success: boolean;
    categories: Array<{
      category: string;
      total_count: number;
      display_name: string;
    }>;
  }> {
    try {
      const allAchievements = await AchievementModel.getAllAchievements(false);

      const categoryMap = new Map();
      const displayNames: Record<string, string> = {
        gameplay: "Gameplay",
        collection: "Collection",
        social: "Social",
        progression: "Progression",
        special: "Special",
      };

      allAchievements.forEach((achievement) => {
        const count = categoryMap.get(achievement.category) || 0;
        categoryMap.set(achievement.category, count + 1);
      });

      const categories = Array.from(categoryMap.entries()).map(
        ([category, count]) => ({
          category,
          total_count: count,
          display_name: displayNames[category] || category,
        })
      );

      return {
        success: true,
        categories,
      };
    } catch (error) {
      console.error("Error fetching achievement categories:", error);
      return {
        success: false,
        categories: [],
      };
    }
  },

  /**
   * Process achievement progress based on game events
   */
  async processAchievementProgress(
    event: AchievementProgressEvent
  ): Promise<AchievementCompletionResult> {
    const result: AchievementCompletionResult = {
      newlyCompleted: [],
      updatedProgress: [],
    };

    try {
      switch (event.eventType) {
        case "game_victory":
          await this.handleGameVictory(event.userId, event.eventData, result);
          break;
        case "game_completion":
          await this.handleGameCompletion(
            event.userId,
            event.eventData,
            result
          );
          break;
        case "pack_opened":
          await this.handlePackOpened(event.userId, event.eventData, result);
          break;
        case "card_collected":
          await this.handleCardCollected(event.userId, event.eventData, result);
          break;
        case "card_leveled":
          await this.handleCardLeveled(event.userId, event.eventData, result);
          break;
        case "xp_transfer":
          await this.handleXpTransfer(event.userId, event.eventData, result);
          break;
        case "card_sacrifice":
          await this.handleCardSacrifice(event.userId, event.eventData, result);
          break;
        case "friend_added":
          await this.handleFriendAdded(event.userId, event.eventData, result);
          break;
        case "friend_challenge":
          await this.handleFriendChallenge(
            event.userId,
            event.eventData,
            result
          );
          break;
        case "user_registration":
          await this.handleUserRegistration(
            event.userId,
            event.eventData,
            result
          );
          break;
        case "story_mode_completion":
          await this.handleStoryModeCompletion(
            event.userId,
            event.eventData,
            result
          );
          break;
        default:
          console.log(`Unknown achievement event type: ${event.eventType}`);
      }
    } catch (error) {
      console.error(
        `Error processing achievement event ${event.eventType}:`,
        error
      );
    }

    // Check for tier unlocks after processing all achievements
    for (const completed of result.newlyCompleted) {
      const unlockedTiers = await this.checkAndUnlockNextTier(
        event.userId,
        completed.achievement.achievement_key
      );
      // Add newly unlocked tiers to updatedProgress so they appear in the response
      result.updatedProgress.push(...unlockedTiers);
    }

    return result;
  },

  /**
   * Handle game victory events
   */
  async handleGameVictory(
    userId: string,
    eventData: any,
    result: AchievementCompletionResult
  ): Promise<void> {
    console.log("handleGameVictory", eventData);
    const { gameMode, isWinStreak, winStreakCount, winnerScore, loserScore } =
      eventData;

    const keysToFetch: string[] = [];
    const updatePromises: Promise<any>[] = [];

    // First Victory
    updatePromises.push(
      AchievementModel.updateUserAchievementProgress(userId, "first_victory", 1)
    );
    keysToFetch.push("first_victory");

    // Game mode specific victories - tiered achievements
    if (gameMode === "solo") {
      // Track solo_wins tiered achievements
      const soloWinsTiers =
        await AchievementModel.getTieredAchievementsByBaseKey("solo_wins");
      for (const tier of soloWinsTiers) {
        updatePromises.push(
          AchievementModel.updateUserAchievementProgress(
            userId,
            tier.achievement_key,
            1
          )
        );
        keysToFetch.push(tier.achievement_key);
      }

      // Keep legacy solo_master for backward compatibility
      updatePromises.push(
        AchievementModel.updateUserAchievementProgress(userId, "solo_master", 1)
      );
      keysToFetch.push("solo_master");
    } else if (gameMode === "pvp") {
      // Track pvp_wins tiered achievements
      const pvpWinsTiers =
        await AchievementModel.getTieredAchievementsByBaseKey("pvp_wins");
      for (const tier of pvpWinsTiers) {
        updatePromises.push(
          AchievementModel.updateUserAchievementProgress(
            userId,
            tier.achievement_key,
            1
          )
        );
        keysToFetch.push(tier.achievement_key);
      }

      // Track pvp_win_streak tiered achievements
      if (isWinStreak && winStreakCount) {
        const streakTiers =
          await AchievementModel.getTieredAchievementsByBaseKey(
            "pvp_win_streak"
          );
        for (const tier of streakTiers) {
          if (winStreakCount >= tier.target_value) {
            updatePromises.push(
              AchievementModel.setUserAchievementProgress(
                userId,
                tier.achievement_key,
                1
              )
            );
            keysToFetch.push(tier.achievement_key);
          }
        }
      }

      // Keep legacy pvp_warrior for backward compatibility
      updatePromises.push(
        AchievementModel.updateUserAchievementProgress(userId, "pvp_warrior", 1)
      );
      keysToFetch.push("pvp_warrior");

      // Keep legacy win_streak_5 for backward compatibility
      if (isWinStreak && winStreakCount >= 5) {
        updatePromises.push(
          AchievementModel.setUserAchievementProgress(userId, "win_streak_5", 1)
        );
        keysToFetch.push("win_streak_5");
      }
    }

    // Perfect game (won 16-0, meaning opponent has no cards on the board)
    if (winnerScore === 16 && loserScore === 0) {
      updatePromises.push(
        AchievementModel.updateUserAchievementProgress(
          userId,
          "perfect_game",
          1
        )
      );
      keysToFetch.push("perfect_game");
    }

    // Score-based achievements (win by margin)
    if (winnerScore !== undefined && loserScore !== undefined) {
      const scoreMargin = winnerScore - loserScore;

      // Dominant victory (win by 10+ points)
      if (scoreMargin >= 10) {
        updatePromises.push(
          AchievementModel.updateUserAchievementProgress(
            userId,
            "dominant_victory",
            1
          )
        );
        keysToFetch.push("dominant_victory");
      }

      // Close victory (win by 1-2 points)
      if (scoreMargin >= 1 && scoreMargin <= 2) {
        updatePromises.push(
          AchievementModel.updateUserAchievementProgress(
            userId,
            "close_victory",
            1
          )
        );
        keysToFetch.push("close_victory");
      }
    }

    // Beta tester (play games during beta)
    updatePromises.push(
      AchievementModel.updateUserAchievementProgress(userId, "beta_tester", 1)
    );
    keysToFetch.push("beta_tester");

    // Execute all updates in parallel
    await Promise.all(updatePromises);

    // Batch fetch all achievement details in a single query
    const achievementDetailsMap =
      await AchievementModel.getUserAchievementsByKeys(userId, keysToFetch);

    // Process results
    achievementDetailsMap.forEach((details) => {
      if (details.is_completed) {
        result.newlyCompleted.push(details);
      } else {
        result.updatedProgress.push(details);
      }
    });
  },

  /**
   * Handle game completion events (including losses)
   */
  async handleGameCompletion(
    userId: string,
    eventData: any,
    result: AchievementCompletionResult
  ): Promise<void> {
    const keysToFetch: string[] = [];
    const updatePromises: Promise<any>[] = [];

    // Track total_matches tiered achievements (solo + multiplayer combined)
    const totalMatchesTiers =
      await AchievementModel.getTieredAchievementsByBaseKey("total_matches");
    for (const tier of totalMatchesTiers) {
      updatePromises.push(
        AchievementModel.updateUserAchievementProgress(
          userId,
          tier.achievement_key,
          1
        )
      );
      keysToFetch.push(tier.achievement_key);
    }

    // Beta tester achievement for any game completion
    updatePromises.push(
      AchievementModel.updateUserAchievementProgress(userId, "beta_tester", 1)
    );
    keysToFetch.push("beta_tester");

    // Execute all updates in parallel
    await Promise.all(updatePromises);

    // Batch fetch all achievement details in a single query
    const achievementDetailsMap =
      await AchievementModel.getUserAchievementsByKeys(userId, keysToFetch);

    // Process results
    achievementDetailsMap.forEach((details) => {
      if (details.is_completed) {
        result.newlyCompleted.push(details);
      } else {
        result.updatedProgress.push(details);
      }
    });
  },

  /**
   * Handle pack opening events
   */
  async handlePackOpened(
    userId: string,
    eventData: any,
    result: AchievementCompletionResult
  ): Promise<void> {
    const keysToFetch: string[] = [];
    const updatePromises: Promise<any>[] = [];

    // Track pack_opening tiered achievements
    const packOpeningTiers =
      await AchievementModel.getTieredAchievementsByBaseKey("pack_opening");
    for (const tier of packOpeningTiers) {
      updatePromises.push(
        AchievementModel.updateUserAchievementProgress(
          userId,
          tier.achievement_key,
          1
        )
      );
      keysToFetch.push(tier.achievement_key);
    }

    // First pack (legacy)
    updatePromises.push(
      AchievementModel.updateUserAchievementProgress(userId, "first_pack", 1)
    );
    keysToFetch.push("first_pack");

    // Pack addict (legacy)
    updatePromises.push(
      AchievementModel.updateUserAchievementProgress(userId, "pack_addict", 1)
    );
    keysToFetch.push("pack_addict");

    // Execute all updates in parallel
    await Promise.all(updatePromises);

    // Batch fetch all achievement details in a single query
    const achievementDetailsMap =
      await AchievementModel.getUserAchievementsByKeys(userId, keysToFetch);

    // Process results
    achievementDetailsMap.forEach((details) => {
      if (details.is_completed) {
        result.newlyCompleted.push(details);
      } else {
        result.updatedProgress.push(details);
      }
    });
  },

  /**
   * Handle card collection events
   */
  async handleCardCollected(
    userId: string,
    eventData: any,
    result: AchievementCompletionResult
  ): Promise<void> {
    const { rarity, totalUniqueCards, totalMythicCards } = eventData;
    const keysToFetch: string[] = [];
    const updatePromises: Promise<any>[] = [];

    // Track card_collection tiered achievements
    if (totalUniqueCards !== undefined) {
      const cardCollectionTiers =
        await AchievementModel.getTieredAchievementsByBaseKey(
          "card_collection"
        );
      for (const tier of cardCollectionTiers) {
        updatePromises.push(
          AchievementModel.setUserAchievementProgress(
            userId,
            tier.achievement_key,
            totalUniqueCards
          )
        );
        keysToFetch.push(tier.achievement_key);
      }
    }

    // Track mythic_collection tiered achievements (cards with +, ++, or +++ variants)
    if (totalMythicCards !== undefined) {
      const mythicCollectionTiers =
        await AchievementModel.getTieredAchievementsByBaseKey(
          "mythic_collection"
        );
      for (const tier of mythicCollectionTiers) {
        updatePromises.push(
          AchievementModel.setUserAchievementProgress(
            userId,
            tier.achievement_key,
            totalMythicCards
          )
        );
        keysToFetch.push(tier.achievement_key);
      }
    }

    // Rare collector (legacy)
    if (RarityUtils.isRare(rarity)) {
      updatePromises.push(
        AchievementModel.updateUserAchievementProgress(
          userId,
          "rare_collector",
          1
        )
      );
      keysToFetch.push("rare_collector");
    }

    // Legendary hunter (legacy)
    if (RarityUtils.isLegendary(rarity)) {
      updatePromises.push(
        AchievementModel.updateUserAchievementProgress(
          userId,
          "legendary_hunter",
          1
        )
      );
      keysToFetch.push("legendary_hunter");
    }

    // Card master (legacy)
    if (totalUniqueCards) {
      updatePromises.push(
        AchievementModel.setUserAchievementProgress(
          userId,
          "card_master",
          totalUniqueCards
        )
      );
      keysToFetch.push("card_master");
    }

    // Execute all updates in parallel
    await Promise.all(updatePromises);

    // Batch fetch all achievement details in a single query
    const achievementDetailsMap =
      await AchievementModel.getUserAchievementsByKeys(userId, keysToFetch);

    // Process results
    achievementDetailsMap.forEach((details) => {
      if (details.is_completed) {
        result.newlyCompleted.push(details);
      } else {
        result.updatedProgress.push(details);
      }
    });
  },

  /**
   * Handle card leveling events
   */
  async handleCardLeveled(
    userId: string,
    eventData: any,
    result: AchievementCompletionResult
  ): Promise<void> {
    const { newLevel, isFirstLevelUp, cardsAtLevelByRarity } = eventData;
    const keysToFetch: string[] = [];
    const updatePromises: Promise<any>[] = [];

    // Track card leveling by rarity achievements
    if (cardsAtLevelByRarity) {
      for (const [rarity, levels] of Object.entries(cardsAtLevelByRarity)) {
        const baseKey = `level_${rarity}`;
        const tiers = await AchievementModel.getTieredAchievementsByBaseKey(
          baseKey
        );

        for (const tier of tiers) {
          // tier.target_value contains the level requirement (2, 3, 4, 5)
          // Ensure target_value is a number
          const targetLevel =
            typeof tier.target_value === "string"
              ? parseInt(tier.target_value)
              : tier.target_value;
          const countAtLevel =
            (levels as Record<number, number>)[targetLevel] || 0;

          if (countAtLevel >= 20) {
            updatePromises.push(
              AchievementModel.setUserAchievementProgress(
                userId,
                tier.achievement_key,
                1
              )
            );
            keysToFetch.push(tier.achievement_key);
          }
        }
      }
    }

    // Level up (first time leveling any card) - legacy
    if (isFirstLevelUp) {
      updatePromises.push(
        AchievementModel.updateUserAchievementProgress(userId, "level_up", 1)
      );
      keysToFetch.push("level_up");
    }

    // Max level (level 10) - legacy
    if (newLevel >= 10) {
      updatePromises.push(
        AchievementModel.updateUserAchievementProgress(userId, "max_level", 1)
      );
      keysToFetch.push("max_level");
    }

    // Execute all updates in parallel
    await Promise.all(updatePromises);

    // Batch fetch all achievement details in a single query
    if (keysToFetch.length > 0) {
      const achievementDetailsMap =
        await AchievementModel.getUserAchievementsByKeys(userId, keysToFetch);

      // Process results
      achievementDetailsMap.forEach((details) => {
        if (details.is_completed) {
          result.newlyCompleted.push(details);
        } else {
          result.updatedProgress.push(details);
        }
      });
    }
  },

  /**
   * Handle XP transfer events
   */
  async handleXpTransfer(
    userId: string,
    eventData: any,
    result: AchievementCompletionResult
  ): Promise<void> {
    // XP Master
    await AchievementModel.updateUserAchievementProgress(
      userId,
      "xp_master",
      1
    );

    // Batch fetch achievement details
    const achievementDetailsMap =
      await AchievementModel.getUserAchievementsByKeys(userId, ["xp_master"]);

    // Process results
    achievementDetailsMap.forEach((details) => {
      if (details.is_completed) {
        result.newlyCompleted.push(details);
      } else {
        result.updatedProgress.push(details);
      }
    });
  },

  /**
   * Handle card sacrifice events
   */
  async handleCardSacrifice(
    userId: string,
    eventData: any,
    result: AchievementCompletionResult
  ): Promise<void> {
    const { cardCount, totalSacrificed } = eventData;
    const keysToFetch: string[] = [];
    const updatePromises: Promise<any>[] = [];

    // Track card_sacrifice tiered achievements
    const sacrificeTiers =
      await AchievementModel.getTieredAchievementsByBaseKey("card_sacrifice");

    if (totalSacrificed !== undefined) {
      for (const tier of sacrificeTiers) {
        updatePromises.push(
          AchievementModel.setUserAchievementProgress(
            userId,
            tier.achievement_key,
            totalSacrificed
          )
        );
        keysToFetch.push(tier.achievement_key);
      }
    } else {
      // Fallback to increment if totalSacrificed not provided
      for (const tier of sacrificeTiers) {
        updatePromises.push(
          AchievementModel.updateUserAchievementProgress(
            userId,
            tier.achievement_key,
            cardCount || 1
          )
        );
        keysToFetch.push(tier.achievement_key);
      }
    }

    // Sacrifice Master (legacy)
    updatePromises.push(
      AchievementModel.updateUserAchievementProgress(
        userId,
        "sacrifice_master",
        cardCount || 1
      )
    );
    keysToFetch.push("sacrifice_master");

    // Execute all updates in parallel
    await Promise.all(updatePromises);

    // Batch fetch all achievement details in a single query
    const achievementDetailsMap =
      await AchievementModel.getUserAchievementsByKeys(userId, keysToFetch);

    // Process results
    achievementDetailsMap.forEach((details) => {
      if (details.is_completed) {
        result.newlyCompleted.push(details);
      } else {
        result.updatedProgress.push(details);
      }
    });
  },

  /**
   * Handle friend addition events
   */
  async handleFriendAdded(
    userId: string,
    eventData: any,
    result: AchievementCompletionResult
  ): Promise<void> {
    const { totalFriends, isFirstFriend } = eventData;
    const keysToFetch: string[] = [];
    const updatePromises: Promise<any>[] = [];

    // Social butterfly (first friend)
    if (isFirstFriend) {
      updatePromises.push(
        AchievementModel.updateUserAchievementProgress(
          userId,
          "social_butterfly",
          1
        )
      );
      keysToFetch.push("social_butterfly");
    }

    // Friend collector (total friends)
    if (totalFriends) {
      updatePromises.push(
        AchievementModel.setUserAchievementProgress(
          userId,
          "friend_collector",
          totalFriends
        )
      );
      keysToFetch.push("friend_collector");
    }

    // Execute all updates in parallel
    await Promise.all(updatePromises);

    // Batch fetch all achievement details in a single query
    if (keysToFetch.length > 0) {
      const achievementDetailsMap =
        await AchievementModel.getUserAchievementsByKeys(userId, keysToFetch);

      // Process results
      achievementDetailsMap.forEach((details) => {
        if (details.is_completed) {
          result.newlyCompleted.push(details);
        } else {
          result.updatedProgress.push(details);
        }
      });
    }
  },

  /**
   * Handle friend challenge events
   */
  async handleFriendChallenge(
    userId: string,
    eventData: any,
    result: AchievementCompletionResult
  ): Promise<void> {
    // Challenger
    await AchievementModel.updateUserAchievementProgress(
      userId,
      "challenger",
      1
    );

    // Batch fetch achievement details
    const achievementDetailsMap =
      await AchievementModel.getUserAchievementsByKeys(userId, ["challenger"]);

    // Process results
    achievementDetailsMap.forEach((details) => {
      if (details.is_completed) {
        result.newlyCompleted.push(details);
      } else {
        result.updatedProgress.push(details);
      }
    });
  },

  /**
   * Handle user registration events
   */
  async handleUserRegistration(
    userId: string,
    eventData: any,
    result: AchievementCompletionResult
  ): Promise<void> {
    // Early adopter (beta period registration)
    await AchievementModel.updateUserAchievementProgress(
      userId,
      "early_adopter",
      1
    );

    // Batch fetch achievement details
    const achievementDetailsMap =
      await AchievementModel.getUserAchievementsByKeys(userId, [
        "early_adopter",
      ]);

    // Process results
    achievementDetailsMap.forEach((details) => {
      if (details.is_completed) {
        result.newlyCompleted.push(details);
      } else {
        result.updatedProgress.push(details);
      }
    });
  },

  /**
   * Handle story mode completion events
   */
  async handleStoryModeCompletion(
    userId: string,
    eventData: any,
    result: AchievementCompletionResult
  ): Promise<void> {
    const { storyId, isWin, victoryMargin, winCount } = eventData;

    if (!storyId) return;

    const keysToFetch: string[] = [];
    const updatePromises: Promise<any>[] = [];

    // Track story win count achievements (story_{storyId}_wins)
    if (isWin && winCount !== undefined) {
      const winsBaseKey = `story_${storyId}_wins`;
      const winsTiers = await AchievementModel.getTieredAchievementsByBaseKey(
        winsBaseKey
      );

      for (const tier of winsTiers) {
        updatePromises.push(
          AchievementModel.setUserAchievementProgress(
            userId,
            tier.achievement_key,
            winCount
          )
        );
        keysToFetch.push(tier.achievement_key);
      }
    }

    // Track victory margin achievements (story_{storyId}_victory_margin)
    if (isWin && victoryMargin !== undefined) {
      const marginBaseKey = `story_${storyId}_victory_margin`;
      const marginTiers = await AchievementModel.getTieredAchievementsByBaseKey(
        marginBaseKey
      );

      for (const tier of marginTiers) {
        // Check if victory margin meets the tier requirement (4, 6, or 8)
        if (victoryMargin >= tier.target_value) {
          updatePromises.push(
            AchievementModel.setUserAchievementProgress(
              userId,
              tier.achievement_key,
              1
            )
          );
          keysToFetch.push(tier.achievement_key);
        }
      }
    }

    // Execute all updates in parallel
    await Promise.all(updatePromises);

    // Batch fetch all achievement details in a single query
    if (keysToFetch.length > 0) {
      const achievementDetailsMap =
        await AchievementModel.getUserAchievementsByKeys(userId, keysToFetch);

      // Process results
      achievementDetailsMap.forEach((details) => {
        if (details.is_completed) {
          result.newlyCompleted.push(details);
        } else {
          result.updatedProgress.push(details);
        }
      });
    }
  },

  /**
   * Check if completing an achievement unlocks the next tier
   * Returns newly unlocked achievements
   */
  async checkAndUnlockNextTier(
    userId: string,
    completedAchievementKey: string
  ): Promise<UserAchievementWithDetails[]> {
    try {
      const completedAchievement = await AchievementModel.getAchievementByKey(
        completedAchievementKey
      );

      if (!completedAchievement || !completedAchievement.base_achievement_key) {
        return []; // Not a tiered achievement or doesn't exist
      }

      // Get the next tier (current tier + 1)
      const nextTierLevel = (completedAchievement.tier_level || 0) + 1;
      const allTiers = await AchievementModel.getTieredAchievementsByBaseKey(
        completedAchievement.base_achievement_key
      );

      const nextTier = allTiers.find(
        (tier) => tier.tier_level === nextTierLevel
      );

      if (!nextTier) {
        return []; // No next tier exists
      }

      // Check if next tier is already unlocked (should be, since we just completed the previous tier)
      const isUnlocked = await AchievementModel.isTierUnlocked(
        userId,
        nextTier.id
      );

      if (isUnlocked) {
        // Get the next tier achievement details with user progress
        const nextTierDetails = await AchievementModel.getUserAchievementByKey(
          userId,
          nextTier.achievement_key
        );

        if (nextTierDetails) {
          return [nextTierDetails];
        }
      }

      return [];
    } catch (error) {
      console.error(
        `Error checking tier unlock for ${completedAchievementKey}:`,
        error
      );
      return [];
    }
  },

  /**
   * Claim achievement rewards
   */
  async claimAchievementRewards(
    userId: string,
    achievementIds: string[]
  ): Promise<ClaimRewardsResult> {
    try {
      const claimedAchievements: UserAchievementWithDetails[] = [];
      const totalRewards = {
        gems: 0,
        fate_coins: 0,
        packs: 0,
        card_fragments: 0,
      };

      // Process each achievement claim
      for (const achievementId of achievementIds) {
        const claimResult = await AchievementModel.claimAchievement(
          userId,
          achievementId
        );

        if (claimResult.success && claimResult.rewards) {
          totalRewards.gems += claimResult.rewards.gems;
          totalRewards.fate_coins += claimResult.rewards.fate_coins || 0;
          totalRewards.packs += claimResult.rewards.packs;
          totalRewards.card_fragments +=
            claimResult.rewards.card_fragments || 0;

          // Get full achievement details
          const achievementDetails =
            await AchievementModel.getUserAchievementByKey(
              userId,
              (
                await AchievementModel.getAchievementById(achievementId)
              )?.achievement_key || ""
            );

          if (achievementDetails) {
            claimedAchievements.push(achievementDetails);
          }
        }
      }

      // Award the rewards to user
      if (totalRewards.gems > 0) {
        await UserModel.updateGems(userId, totalRewards.gems);
      }

      if (totalRewards.fate_coins > 0) {
        await UserModel.updateFateCoins(userId, totalRewards.fate_coins);
      }

      if (totalRewards.packs > 0) {
        await UserModel.addPacks(userId, totalRewards.packs);
      }

      if (totalRewards.card_fragments > 0) {
        await UserModel.updateCardFragments(
          userId,
          totalRewards.card_fragments
        );
      }

      // Get updated user currencies
      const updatedUser = await UserModel.findById(userId);

      // Check for completionist achievement
      const stats = await AchievementModel.getUserAchievementStats(userId);
      if (stats.completed_achievements >= 50) {
        await AchievementModel.setUserAchievementProgress(
          userId,
          "completionist",
          stats.completed_achievements
        );
      }

      return {
        success: true,
        claimedAchievements,
        totalRewards,
        updatedCurrencies: {
          gems: updatedUser?.gems || 0,
          fate_coins: updatedUser?.fate_coins || 0,
          pack_count: updatedUser?.pack_count || 0,
          card_fragments: updatedUser?.card_fragments || 0,
          total_xp: updatedUser?.total_xp || 0,
        },
      };
    } catch (error) {
      console.error("Error claiming achievement rewards:", error);
      return {
        success: false,
        claimedAchievements: [],
        totalRewards: { gems: 0, fate_coins: 0, packs: 0, card_fragments: 0 },
      };
    }
  },

  /**
   * Get recently completed achievements
   */
  async getRecentlyCompletedAchievements(
    userId: string,
    limit: number = 5
  ): Promise<{
    success: boolean;
    achievements: UserAchievementWithDetails[];
  }> {
    try {
      const achievements =
        await AchievementModel.getRecentlyCompletedAchievements(userId, limit);

      return {
        success: true,
        achievements,
      };
    } catch (error) {
      console.error("Error fetching recently completed achievements:", error);
      return {
        success: false,
        achievements: [],
      };
    }
  },

  /**
   * Trigger achievement events from other services
   */
  async triggerAchievementEvent(
    event: AchievementProgressEvent
  ): Promise<UserAchievementWithDetails[]> {
    const result = await this.processAchievementProgress(event);
    return [...result.newlyCompleted, ...result.updatedProgress];
  },
};

export default AchievementService;
