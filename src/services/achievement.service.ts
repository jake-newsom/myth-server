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
    gold: number;
    gems: number;
    packs: number;
  };
  updatedCurrencies?: {
    gold: number;
    gems: number;
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
        AchievementModel.getAllUserAchievements(userId, category, includeLocked),
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
          total_rewards_earned: { gold: 0, gems: 0, packs: 0 },
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
    const { gameMode, isWinStreak, winStreakCount } = eventData;

    // First Victory
    const firstVictory = await AchievementModel.updateUserAchievementProgress(
      userId,
      "first_victory",
      1
    );
    if (firstVictory) {
      const details = await AchievementModel.getUserAchievementByKey(
        userId,
        "first_victory"
      );
      if (details && details.is_completed) result.newlyCompleted.push(details);
      else if (details) result.updatedProgress.push(details);
    }

    // Game mode specific victories - tiered achievements
    if (gameMode === "solo") {
      // Track solo_wins tiered achievements
      const soloWinsTiers = await AchievementModel.getTieredAchievementsByBaseKey("solo_wins");
      for (const tier of soloWinsTiers) {
        const updated = await AchievementModel.updateUserAchievementProgress(
          userId,
          tier.achievement_key,
          1
        );
        if (updated) {
          const details = await AchievementModel.getUserAchievementByKey(
            userId,
            tier.achievement_key
          );
          if (details && details.is_completed)
            result.newlyCompleted.push(details);
          else if (details) result.updatedProgress.push(details);
        }
      }
      
      // Keep legacy solo_master for backward compatibility
      const soloMaster = await AchievementModel.updateUserAchievementProgress(
        userId,
        "solo_master",
        1
      );
      if (soloMaster) {
        const details = await AchievementModel.getUserAchievementByKey(
          userId,
          "solo_master"
        );
        if (details && details.is_completed)
          result.newlyCompleted.push(details);
        else if (details) result.updatedProgress.push(details);
      }
    } else if (gameMode === "pvp") {
      // Track pvp_wins tiered achievements
      const pvpWinsTiers = await AchievementModel.getTieredAchievementsByBaseKey("pvp_wins");
      for (const tier of pvpWinsTiers) {
        const updated = await AchievementModel.updateUserAchievementProgress(
          userId,
          tier.achievement_key,
          1
        );
        if (updated) {
          const details = await AchievementModel.getUserAchievementByKey(
            userId,
            tier.achievement_key
          );
          if (details && details.is_completed)
            result.newlyCompleted.push(details);
          else if (details) result.updatedProgress.push(details);
        }
      }
      
      // Track pvp_win_streak tiered achievements
      if (isWinStreak && winStreakCount) {
        const streakTiers = await AchievementModel.getTieredAchievementsByBaseKey("pvp_win_streak");
        for (const tier of streakTiers) {
          if (winStreakCount >= tier.target_value) {
            const updated = await AchievementModel.setUserAchievementProgress(
              userId,
              tier.achievement_key,
              1
            );
            if (updated) {
              const details = await AchievementModel.getUserAchievementByKey(
                userId,
                tier.achievement_key
              );
              if (details && details.is_completed)
                result.newlyCompleted.push(details);
              else if (details) result.updatedProgress.push(details);
            }
          }
        }
      }
      
      // Keep legacy pvp_warrior for backward compatibility
      const pvpWarrior = await AchievementModel.updateUserAchievementProgress(
        userId,
        "pvp_warrior",
        1
      );
      if (pvpWarrior) {
        const details = await AchievementModel.getUserAchievementByKey(
          userId,
          "pvp_warrior"
        );
        if (details && details.is_completed)
          result.newlyCompleted.push(details);
        else if (details) result.updatedProgress.push(details);
      }
      
      // Keep legacy win_streak_5 for backward compatibility
      if (isWinStreak && winStreakCount >= 5) {
        const winStreak = await AchievementModel.setUserAchievementProgress(
          userId,
          "win_streak_5",
          1
        );
        if (winStreak) {
          const details = await AchievementModel.getUserAchievementByKey(
            userId,
            "win_streak_5"
          );
          if (details && details.is_completed)
            result.newlyCompleted.push(details);
          else if (details) result.updatedProgress.push(details);
        }
      }
    }

    // Perfect game (no cards lost)
    if (eventData.cardsLost === 0) {
      const perfectGame = await AchievementModel.updateUserAchievementProgress(
        userId,
        "perfect_game",
        1
      );
      if (perfectGame) {
        const details = await AchievementModel.getUserAchievementByKey(
          userId,
          "perfect_game"
        );
        if (details && details.is_completed)
          result.newlyCompleted.push(details);
        else if (details) result.updatedProgress.push(details);
      }
    }

    // Beta tester (play games during beta)
    const betaTester = await AchievementModel.updateUserAchievementProgress(
      userId,
      "beta_tester",
      1
    );
    if (betaTester) {
      const details = await AchievementModel.getUserAchievementByKey(
        userId,
        "beta_tester"
      );
      if (details && details.is_completed) result.newlyCompleted.push(details);
      else if (details) result.updatedProgress.push(details);
    }
  },

  /**
   * Handle game completion events (including losses)
   */
  async handleGameCompletion(
    userId: string,
    eventData: any,
    result: AchievementCompletionResult
  ): Promise<void> {
    // Track total_matches tiered achievements (solo + multiplayer combined)
    const totalMatchesTiers = await AchievementModel.getTieredAchievementsByBaseKey("total_matches");
    for (const tier of totalMatchesTiers) {
      const updated = await AchievementModel.updateUserAchievementProgress(
        userId,
        tier.achievement_key,
        1
      );
      if (updated) {
        const details = await AchievementModel.getUserAchievementByKey(
          userId,
          tier.achievement_key
        );
        if (details && details.is_completed) result.newlyCompleted.push(details);
        else if (details) result.updatedProgress.push(details);
      }
    }
    
    // Beta tester achievement for any game completion
    const betaTester = await AchievementModel.updateUserAchievementProgress(
      userId,
      "beta_tester",
      1
    );
    if (betaTester) {
      const details = await AchievementModel.getUserAchievementByKey(
        userId,
        "beta_tester"
      );
      if (details && details.is_completed) result.newlyCompleted.push(details);
      else if (details) result.updatedProgress.push(details);
    }
  },

  /**
   * Handle pack opening events
   */
  async handlePackOpened(
    userId: string,
    eventData: any,
    result: AchievementCompletionResult
  ): Promise<void> {
    // Track pack_opening tiered achievements
    const packOpeningTiers = await AchievementModel.getTieredAchievementsByBaseKey("pack_opening");
    for (const tier of packOpeningTiers) {
      const updated = await AchievementModel.updateUserAchievementProgress(
        userId,
        tier.achievement_key,
        1
      );
      if (updated) {
        const details = await AchievementModel.getUserAchievementByKey(
          userId,
          tier.achievement_key
        );
        if (details && details.is_completed) result.newlyCompleted.push(details);
        else if (details) result.updatedProgress.push(details);
      }
    }
    
    // First pack (legacy)
    const firstPack = await AchievementModel.updateUserAchievementProgress(
      userId,
      "first_pack",
      1
    );
    if (firstPack) {
      const details = await AchievementModel.getUserAchievementByKey(
        userId,
        "first_pack"
      );
      if (details && details.is_completed) result.newlyCompleted.push(details);
      else if (details) result.updatedProgress.push(details);
    }

    // Pack addict (legacy)
    const packAddict = await AchievementModel.updateUserAchievementProgress(
      userId,
      "pack_addict",
      1
    );
    if (packAddict) {
      const details = await AchievementModel.getUserAchievementByKey(
        userId,
        "pack_addict"
      );
      if (details && details.is_completed) result.newlyCompleted.push(details);
      else if (details) result.updatedProgress.push(details);
    }
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

    // Track card_collection tiered achievements
    if (totalUniqueCards !== undefined) {
      const cardCollectionTiers = await AchievementModel.getTieredAchievementsByBaseKey("card_collection");
      for (const tier of cardCollectionTiers) {
        const updated = await AchievementModel.setUserAchievementProgress(
          userId,
          tier.achievement_key,
          totalUniqueCards
        );
        if (updated) {
          const details = await AchievementModel.getUserAchievementByKey(
            userId,
            tier.achievement_key
          );
          if (details && details.is_completed)
            result.newlyCompleted.push(details);
          else if (details) result.updatedProgress.push(details);
        }
      }
    }

    // Track mythic_collection tiered achievements (cards with +, ++, or +++ variants)
    if (totalMythicCards !== undefined) {
      const mythicCollectionTiers = await AchievementModel.getTieredAchievementsByBaseKey("mythic_collection");
      for (const tier of mythicCollectionTiers) {
        const updated = await AchievementModel.setUserAchievementProgress(
          userId,
          tier.achievement_key,
          totalMythicCards
        );
        if (updated) {
          const details = await AchievementModel.getUserAchievementByKey(
            userId,
            tier.achievement_key
          );
          if (details && details.is_completed)
            result.newlyCompleted.push(details);
          else if (details) result.updatedProgress.push(details);
        }
      }
    }

    // Rare collector (legacy)
    if (RarityUtils.isRare(rarity)) {
      const rareCollector =
        await AchievementModel.updateUserAchievementProgress(
          userId,
          "rare_collector",
          1
        );
      if (rareCollector) {
        const details = await AchievementModel.getUserAchievementByKey(
          userId,
          "rare_collector"
        );
        if (details && details.is_completed)
          result.newlyCompleted.push(details);
        else if (details) result.updatedProgress.push(details);
      }
    }

    // Legendary hunter (legacy)
    if (RarityUtils.isLegendary(rarity)) {
      const legendaryHunter =
        await AchievementModel.updateUserAchievementProgress(
          userId,
          "legendary_hunter",
          1
        );
      if (legendaryHunter) {
        const details = await AchievementModel.getUserAchievementByKey(
          userId,
          "legendary_hunter"
        );
        if (details && details.is_completed)
          result.newlyCompleted.push(details);
        else if (details) result.updatedProgress.push(details);
      }
    }

    // Card master (legacy)
    if (totalUniqueCards) {
      const cardMaster = await AchievementModel.setUserAchievementProgress(
        userId,
        "card_master",
        totalUniqueCards
      );
      if (cardMaster) {
        const details = await AchievementModel.getUserAchievementByKey(
          userId,
          "card_master"
        );
        if (details && details.is_completed)
          result.newlyCompleted.push(details);
        else if (details) result.updatedProgress.push(details);
      }
    }
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

    // Track card leveling by rarity achievements
    if (cardsAtLevelByRarity) {
      for (const [rarity, levels] of Object.entries(cardsAtLevelByRarity)) {
        const baseKey = `level_${rarity}`;
        const tiers = await AchievementModel.getTieredAchievementsByBaseKey(baseKey);
        
        for (const tier of tiers) {
          // tier.target_value contains the level requirement (2, 3, 4, 5)
          const countAtLevel = (levels as Record<number, number>)[tier.target_value] || 0;
          
          if (countAtLevel >= 20) {
            const updated = await AchievementModel.setUserAchievementProgress(
              userId,
              tier.achievement_key,
              1
            );
            if (updated) {
              const details = await AchievementModel.getUserAchievementByKey(
                userId,
                tier.achievement_key
              );
              if (details && details.is_completed)
                result.newlyCompleted.push(details);
              else if (details) result.updatedProgress.push(details);
            }
          }
        }
      }
    }

    // Level up (first time leveling any card) - legacy
    if (isFirstLevelUp) {
      const levelUp = await AchievementModel.updateUserAchievementProgress(
        userId,
        "level_up",
        1
      );
      if (levelUp) {
        const details = await AchievementModel.getUserAchievementByKey(
          userId,
          "level_up"
        );
        if (details && details.is_completed)
          result.newlyCompleted.push(details);
        else if (details) result.updatedProgress.push(details);
      }
    }

    // Max level (level 10) - legacy
    if (newLevel >= 10) {
      const maxLevel = await AchievementModel.updateUserAchievementProgress(
        userId,
        "max_level",
        1
      );
      if (maxLevel) {
        const details = await AchievementModel.getUserAchievementByKey(
          userId,
          "max_level"
        );
        if (details && details.is_completed)
          result.newlyCompleted.push(details);
        else if (details) result.updatedProgress.push(details);
      }
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
    const xpMaster = await AchievementModel.updateUserAchievementProgress(
      userId,
      "xp_master",
      1
    );
    if (xpMaster) {
      const details = await AchievementModel.getUserAchievementByKey(
        userId,
        "xp_master"
      );
      if (details && details.is_completed) result.newlyCompleted.push(details);
      else if (details) result.updatedProgress.push(details);
    }
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

    // Track card_sacrifice tiered achievements
    if (totalSacrificed !== undefined) {
      const sacrificeTiers = await AchievementModel.getTieredAchievementsByBaseKey("card_sacrifice");
      for (const tier of sacrificeTiers) {
        const updated = await AchievementModel.setUserAchievementProgress(
          userId,
          tier.achievement_key,
          totalSacrificed
        );
        if (updated) {
          const details = await AchievementModel.getUserAchievementByKey(
            userId,
            tier.achievement_key
          );
          if (details && details.is_completed) result.newlyCompleted.push(details);
          else if (details) result.updatedProgress.push(details);
        }
      }
    } else {
      // Fallback to increment if totalSacrificed not provided
      const sacrificeTiers = await AchievementModel.getTieredAchievementsByBaseKey("card_sacrifice");
      for (const tier of sacrificeTiers) {
        const updated = await AchievementModel.updateUserAchievementProgress(
          userId,
          tier.achievement_key,
          cardCount || 1
        );
        if (updated) {
          const details = await AchievementModel.getUserAchievementByKey(
            userId,
            tier.achievement_key
          );
          if (details && details.is_completed) result.newlyCompleted.push(details);
          else if (details) result.updatedProgress.push(details);
        }
      }
    }

    // Sacrifice Master (legacy)
    const sacrificeMaster =
      await AchievementModel.updateUserAchievementProgress(
        userId,
        "sacrifice_master",
        cardCount || 1
      );
    if (sacrificeMaster) {
      const details = await AchievementModel.getUserAchievementByKey(
        userId,
        "sacrifice_master"
      );
      if (details && details.is_completed) result.newlyCompleted.push(details);
      else if (details) result.updatedProgress.push(details);
    }
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

    // Social butterfly (first friend)
    if (isFirstFriend) {
      const socialButterfly =
        await AchievementModel.updateUserAchievementProgress(
          userId,
          "social_butterfly",
          1
        );
      if (socialButterfly) {
        const details = await AchievementModel.getUserAchievementByKey(
          userId,
          "social_butterfly"
        );
        if (details && details.is_completed)
          result.newlyCompleted.push(details);
        else if (details) result.updatedProgress.push(details);
      }
    }

    // Friend collector (total friends)
    if (totalFriends) {
      const friendCollector = await AchievementModel.setUserAchievementProgress(
        userId,
        "friend_collector",
        totalFriends
      );
      if (friendCollector) {
        const details = await AchievementModel.getUserAchievementByKey(
          userId,
          "friend_collector"
        );
        if (details && details.is_completed)
          result.newlyCompleted.push(details);
        else if (details) result.updatedProgress.push(details);
      }
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
    const challenger = await AchievementModel.updateUserAchievementProgress(
      userId,
      "challenger",
      1
    );
    if (challenger) {
      const details = await AchievementModel.getUserAchievementByKey(
        userId,
        "challenger"
      );
      if (details && details.is_completed) result.newlyCompleted.push(details);
      else if (details) result.updatedProgress.push(details);
    }
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
    const earlyAdopter = await AchievementModel.updateUserAchievementProgress(
      userId,
      "early_adopter",
      1
    );
    if (earlyAdopter) {
      const details = await AchievementModel.getUserAchievementByKey(
        userId,
        "early_adopter"
      );
      if (details && details.is_completed) result.newlyCompleted.push(details);
      else if (details) result.updatedProgress.push(details);
    }
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

    // Track story win count achievements (story_{storyId}_wins)
    if (isWin && winCount !== undefined) {
      const winsBaseKey = `story_${storyId}_wins`;
      const winsTiers = await AchievementModel.getTieredAchievementsByBaseKey(winsBaseKey);
      
      for (const tier of winsTiers) {
        const updated = await AchievementModel.setUserAchievementProgress(
          userId,
          tier.achievement_key,
          winCount
        );
        if (updated) {
          const details = await AchievementModel.getUserAchievementByKey(
            userId,
            tier.achievement_key
          );
          if (details && details.is_completed) result.newlyCompleted.push(details);
          else if (details) result.updatedProgress.push(details);
        }
      }
    }

    // Track victory margin achievements (story_{storyId}_victory_margin)
    if (isWin && victoryMargin !== undefined) {
      const marginBaseKey = `story_${storyId}_victory_margin`;
      const marginTiers = await AchievementModel.getTieredAchievementsByBaseKey(marginBaseKey);
      
      for (const tier of marginTiers) {
        // Check if victory margin meets the tier requirement (4, 6, or 8)
        if (victoryMargin >= tier.target_value) {
          const updated = await AchievementModel.setUserAchievementProgress(
            userId,
            tier.achievement_key,
            1
          );
          if (updated) {
            const details = await AchievementModel.getUserAchievementByKey(
              userId,
              tier.achievement_key
            );
            if (details && details.is_completed) result.newlyCompleted.push(details);
            else if (details) result.updatedProgress.push(details);
          }
        }
      }
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
      const totalRewards = { gold: 0, gems: 0, packs: 0 };

      // Process each achievement claim
      for (const achievementId of achievementIds) {
        const claimResult = await AchievementModel.claimAchievement(
          userId,
          achievementId
        );

        if (claimResult.success && claimResult.rewards) {
          totalRewards.gold += claimResult.rewards.gold;
          totalRewards.gems += claimResult.rewards.gems;
          totalRewards.packs += claimResult.rewards.packs;

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
      if (totalRewards.gold > 0 || totalRewards.gems > 0) {
        await UserModel.updateBothCurrencies(
          userId,
          totalRewards.gold,
          totalRewards.gems
        );
      }

      if (totalRewards.packs > 0) {
        await UserModel.addPacks(userId, totalRewards.packs);
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
          gold: updatedUser?.gold || 0,
          gems: updatedUser?.gems || 0,
          total_xp: updatedUser?.total_xp || 0,
        },
      };
    } catch (error) {
      console.error("Error claiming achievement rewards:", error);
      return {
        success: false,
        claimedAchievements: [],
        totalRewards: { gold: 0, gems: 0, packs: 0 },
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
