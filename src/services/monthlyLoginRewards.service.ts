import MonthlyLoginRewardsModel from "../models/monthlyLoginRewards.model";
import UserModel from "../models/user.model";
import PackService from "./pack.service";
import {
  MonthlyLoginConfig,
  UserMonthlyLoginProgress,
  MonthlyRewardType,
} from "../types/database.types";
import {
  MonthlyLoginStatusResponse,
  ClaimMonthlyRewardResponse,
} from "../types/api.types";
import logger from "../utils/logger";
import db from "../config/db.config";

const MonthlyLoginRewardsService = {
  /**
   * Get current month-year string in YYYY-MM format (UTC)
   */
  getCurrentMonthYear(): string {
    const now = new Date();
    const utcYear = now.getUTCFullYear();
    const utcMonth = String(now.getUTCMonth() + 1).padStart(2, "0");
    return `${utcYear}-${utcMonth}`;
  },

  /**
   * Get current day of month (1-31) based on server time (UTC)
   */
  getCurrentDayOfMonth(): number {
    const now = new Date();
    return now.getUTCDate();
  },

  /**
   * Get reward configuration for all 24 days
   */
  async getMonthlyRewardConfig(): Promise<MonthlyLoginConfig[]> {
    return await MonthlyLoginRewardsModel.getRewardConfig();
  },

  /**
   * Get user's monthly login progress for current month
   */
  async getUserMonthlyProgress(
    userId: string
  ): Promise<UserMonthlyLoginProgress | null> {
    const monthYear = this.getCurrentMonthYear();
    let progress = await MonthlyLoginRewardsModel.getUserProgress(
      userId,
      monthYear
    );

    // Create progress if it doesn't exist
    if (!progress) {
      progress = await MonthlyLoginRewardsModel.createUserProgress(
        userId,
        monthYear
      );
    }

    return progress;
  },

  /**
   * Get monthly login status for a user
   */
  async getMonthlyLoginStatus(
    userId: string
  ): Promise<MonthlyLoginStatusResponse> {
    const monthYear = this.getCurrentMonthYear();
    const currentDay = this.getCurrentDayOfMonth();
    const maxDay = Math.min(currentDay, 24); // Cap at 24 days

    // Get or create user progress
    let progress = await MonthlyLoginRewardsModel.getUserProgress(
      userId,
      monthYear
    );
    if (!progress) {
      progress = await MonthlyLoginRewardsModel.createUserProgress(
        userId,
        monthYear
      );
    }

    // Get all reward configurations
    const configs = await this.getMonthlyRewardConfig();
    const configMap = new Map(configs.map((c) => [c.day, c]));

    // Build rewards array
    const rewards = [];
    for (let day = 1; day <= 24; day++) {
      const config = configMap.get(day);
      if (!config) continue;

      const isClaimed = progress.claimed_days.includes(day);
      const canClaim =
        !isClaimed && day <= maxDay && day <= progress.current_day + 1;

      rewards.push({
        day,
        reward_type: config.reward_type,
        amount: config.amount,
        is_claimed: isClaimed,
        can_claim: canClaim,
      });
    }

    // Calculate available days (unclaimed days up to current day)
    const availableDays = rewards
      .filter((r) => r.can_claim)
      .map((r) => r.day);

    return {
      month_year: monthYear,
      current_day: progress.current_day,
      claimed_days: progress.claimed_days,
      available_days: availableDays,
      rewards,
    };
  },

  /**
   * Claim the next available daily reward
   */
  async claimNextAvailableReward(
    userId: string
  ): Promise<ClaimMonthlyRewardResponse> {
    const monthYear = this.getCurrentMonthYear();
    const currentDay = this.getCurrentDayOfMonth();
    const maxDay = Math.min(currentDay, 24);

    // Get or create user progress
    let progress = await MonthlyLoginRewardsModel.getUserProgress(
      userId,
      monthYear
    );
    if (!progress) {
      progress = await MonthlyLoginRewardsModel.createUserProgress(
        userId,
        monthYear
      );
    }

    // Find the next available day (current_day + 1, but not exceeding maxDay)
    const nextDay = progress.current_day + 1;

    if (nextDay > maxDay) {
      throw new Error(
        `No rewards available to claim. Current day is ${currentDay}, and you've already claimed up to day ${progress.current_day}.`
      );
    }

    if (progress.claimed_days.includes(nextDay)) {
      throw new Error(
        `Day ${nextDay} has already been claimed. Please refresh your status.`
      );
    }

    // Claim the next day
    return await this.claimDailyReward(userId, nextDay);
  },

  /**
   * Claim a daily reward for a specific day
   */
  async claimDailyReward(
    userId: string,
    day: number
  ): Promise<ClaimMonthlyRewardResponse> {
    // Validate day range
    if (day < 1 || day > 24) {
      throw new Error("Day must be between 1 and 24");
    }

    const monthYear = this.getCurrentMonthYear();
    const currentDay = this.getCurrentDayOfMonth();
    const maxDay = Math.min(currentDay, 24);

    // Get or create user progress
    let progress = await MonthlyLoginRewardsModel.getUserProgress(
      userId,
      monthYear
    );
    if (!progress) {
      progress = await MonthlyLoginRewardsModel.createUserProgress(
        userId,
        monthYear
      );
    }

    // Validate claim eligibility
    if (progress.claimed_days.includes(day)) {
      throw new Error(`Day ${day} reward has already been claimed`);
    }

    if (day > maxDay) {
      throw new Error(
        `Day ${day} is not available yet. Current day is ${currentDay}`
      );
    }

    if (day > progress.current_day + 1) {
      throw new Error(
        `Day ${day} cannot be claimed yet. Please claim days sequentially.`
      );
    }

    // Get reward configuration
    const config = await MonthlyLoginRewardsModel.getRewardConfigByDay(day);
    if (!config) {
      throw new Error(`No reward configuration found for day ${day}`);
    }

    // Distribute the reward and get the user_card_instance_id if it's an enhanced_card
    const distributedCardInstanceId = await this.distributeReward(userId, config);

    // Update user progress
    const updatedProgress = await MonthlyLoginRewardsModel.addClaimedDay(
      userId,
      monthYear,
      day
    );

    if (!updatedProgress) {
      throw new Error("Failed to update user progress");
    }

    return {
      success: true,
      message: `Successfully claimed reward for day ${day}`,
      reward: {
        day,
        reward_type: config.reward_type,
        amount: config.amount,
        card_id: distributedCardInstanceId || config.card_id || undefined,
      },
      updated_progress: {
        current_day: updatedProgress.current_day,
        claimed_days: updatedProgress.claimed_days,
      },
    };
  },

  /**
   * Distribute a reward to a user based on reward type
   * @returns user_card_instance_id if reward_type is enhanced_card, otherwise undefined
   */
  async distributeReward(
    userId: string,
    config: MonthlyLoginConfig
  ): Promise<string | undefined> {
    switch (config.reward_type) {
      case "gems":
        await UserModel.updateGems(userId, config.amount);
        logger.info(`Distributed ${config.amount} gems to user ${userId}`);
        return undefined;

      case "fate_coins":
        await UserModel.updateFateCoins(userId, config.amount);
        logger.info(
          `Distributed ${config.amount} fate coins to user ${userId}`
        );
        return undefined;

      case "card_fragments":
        await UserModel.updateCardFragments(userId, config.amount);
        logger.info(
          `Distributed ${config.amount} card fragments to user ${userId}`
        );
        return undefined;

      case "card_pack":
        await UserModel.addPacks(userId, config.amount);
        logger.info(`Distributed ${config.amount} pack(s) to user ${userId}`);
        return undefined;

      case "enhanced_card":
        const userCardInstanceId = await this.distributeEnhancedCard(userId, config);
        return userCardInstanceId;

      default:
        throw new Error(`Unknown reward type: ${config.reward_type}`);
    }
  },

  /**
   * Distribute an enhanced card to a user
   * @returns The user_card_instance_id of the card instance that was created
   */
  async distributeEnhancedCard(
    userId: string,
    config: MonthlyLoginConfig
  ): Promise<string> {
    let cardId: string | null = null;

    // If specific card_id is provided, use it; otherwise get random enhanced card
    if (config.card_id) {
      cardId = config.card_id;
    } else {
      cardId = await MonthlyLoginRewardsModel.getRandomEnhancedCard();
    }

    if (!cardId) {
      throw new Error("No enhanced card available to distribute");
    }

    // Add card to user's collection and return the instance ID
    const query = `
      INSERT INTO "user_owned_cards" (user_id, card_id, level, xp, created_at)
      VALUES ($1, $2, 1, 0, NOW())
      RETURNING user_card_instance_id;
    `;
    const { rows } = await db.query(query, [userId, cardId]);
    const userCardInstanceId = rows[0].user_card_instance_id;

    logger.info(`Distributed enhanced card ${cardId} (instance: ${userCardInstanceId}) to user ${userId}`);
    
    return userCardInstanceId;
  },

  /**
   * Reset all users' monthly progress (called on 1st of each month)
   */
  async resetMonthlyProgress(): Promise<number> {
    const deletedCount = await MonthlyLoginRewardsModel.resetAllUserProgress();
    logger.info(
      `Reset monthly login progress for all users. Deleted ${deletedCount} progress records.`
    );
    return deletedCount;
  },
};

export default MonthlyLoginRewardsService;

