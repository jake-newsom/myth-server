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
    unclaimedOnly: boolean = false
  ): Promise<{
    success: boolean;
    achievements: UserAchievementWithDetails[];
    stats: any;
  }> {
    try {
      const [achievements, stats] = await Promise.all([
        AchievementModel.getAllUserAchievements(userId, category),
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
        default:
          console.log(`Unknown achievement event type: ${event.eventType}`);
      }
    } catch (error) {
      console.error(
        `Error processing achievement event ${event.eventType}:`,
        error
      );
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

    // Game mode specific victories
    if (gameMode === "solo") {
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
    }

    // Win streak achievements
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
    // First pack
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

    // Pack addict
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
    const { rarity, totalUniqueCards } = eventData;

    // Rare collector (including variants)
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

    // Legendary hunter (including variants)
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

    // Card master (total unique cards)
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
    const { newLevel, isFirstLevelUp } = eventData;

    // Level up (first time leveling any card)
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

    // Max level (level 10)
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
    const { cardCount } = eventData;

    // Sacrifice Master
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
