import MonthlyLoginRewardsModel from "../models/monthlyLoginRewards.model";
import RewardService from "./reward.service";
import { monthlyLoginRewardToItems } from "../utils/rewards.helpers";
import {
  MonthlyLoginConfig,
  UserMonthlyLoginProgress,
} from "../types/database.types";
import {
  MonthlyLoginStatusResponse,
  ClaimMonthlyRewardResponse,
} from "../types/api.types";
import { RewardItem } from "../types/service.types";
import logger from "../utils/logger";
import db, { PoolClient } from "../config/db.config";

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
   * Get current date string in YYYY-MM-DD format (UTC)
   */
  getCurrentDateString(): string {
    const now = new Date();
    const utcYear = now.getUTCFullYear();
    const utcMonth = String(now.getUTCMonth() + 1).padStart(2, "0");
    const utcDay = String(now.getUTCDate()).padStart(2, "0");
    return `${utcYear}-${utcMonth}-${utcDay}`;
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

    // Check if the user has already claimed a reward today
    const today = this.getCurrentDateString();
    const claimedToday = progress.last_claim_date
      ? (typeof progress.last_claim_date === "string"
          ? progress.last_claim_date.split("T")[0]
          : (progress.last_claim_date as Date).toISOString().split("T")[0]) ===
        today
      : false;

    // Build rewards array
    const rewards = [];
    for (let day = 1; day <= 24; day++) {
      const config = configMap.get(day);
      if (!config) continue;

      const isClaimed = progress.claimed_days.includes(day);
      const isNext = !isClaimed && day === progress.current_day + 1 && day <= maxDay;
      const canClaim = isNext && !claimedToday;

      rewards.push({
        day,
        reward_type: config.reward_type,
        amount: config.amount,
        is_claimed: isClaimed,
        can_claim: canClaim,
        is_next: isNext,
      });
    }

    // Calculate available days (unclaimed days up to current day)
    const availableDays = rewards
      .filter((r) => r.can_claim)
      .map((r) => r.day);

    return {
      month_year: monthYear,
      // `current_day` is retained for backward compatibility with older clients.
      // New clients should prefer `current_claimed_day`.
      current_day: progress.current_day,
      current_claimed_day: progress.current_day,
      server_day_of_month: maxDay,
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

    // Check if user has already claimed today
    const today = this.getCurrentDateString();
    if (progress.last_claim_date) {
      const lastClaimDateStr = typeof progress.last_claim_date === 'string' 
        ? progress.last_claim_date.split('T')[0]
        : progress.last_claim_date.toISOString().split('T')[0];
      
      if (lastClaimDateStr === today) {
        throw new Error(
          "You have already claimed your daily reward today. Please come back tomorrow."
        );
      }
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

    // Pre-resolve any randomized payload (random enhanced_card) so the
    // RewardItem we hand to RewardService is fully deterministic. This keeps
    // the random-card selection outside the transaction and ensures we don't
    // double-resolve on retry.
    let resolvedCardId: string | undefined;
    if (config.reward_type === "enhanced_card") {
      resolvedCardId = config.card_id || undefined;
      if (!resolvedCardId) {
        const randomCardId =
          await MonthlyLoginRewardsModel.getRandomEnhancedCard();
        if (!randomCardId) {
          throw new Error("No enhanced card available to distribute");
        }
        resolvedCardId = randomCardId;
      }
    }

    const items = monthlyLoginRewardToItems({
      reward_type: config.reward_type,
      amount: config.amount,
      card_id: resolvedCardId ?? null,
      reward_border_id: config.reward_border_id ?? null,
    });

    // Run reward distribution and progress update inside a transaction so that
    // a failed progress write rolls back the reward rather than leaving them
    // out of sync (e.g. gems credited but claimed_days not updated).
    const client: PoolClient = await db.getClient();
    let updatedProgress: UserMonthlyLoginProgress | null;
    let distributedCardInstanceId: string | undefined;
    let distributedBorderId: string | undefined;
    try {
      await client.query("BEGIN");

      const grantResult = await RewardService.grantRewards(userId, items, {
        client,
      });

      if (!grantResult.success) {
        throw new Error(grantResult.error || "Failed to distribute reward");
      }

      for (const granted of grantResult.granted) {
        if (granted.item.type === "card" && granted.user_card_instance_id) {
          distributedCardInstanceId = granted.user_card_instance_id;
        }
        if (granted.item.type === "border") {
          distributedBorderId = granted.item.border_id;
        }
      }

      const today = this.getCurrentDateString();
      updatedProgress = await MonthlyLoginRewardsModel.addClaimedDay(
        userId,
        monthYear,
        day,
        today,
        client
      );

      if (!updatedProgress) {
        throw new Error("Failed to update user progress");
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    logger.info(
      `Distributed monthly login reward (${config.reward_type}) to user ${userId} for day ${day}`
    );

    return {
      success: true,
      message: `Successfully claimed reward for day ${day}`,
      reward: {
        day,
        reward_type: config.reward_type,
        amount: config.amount,
        card_id: distributedCardInstanceId,
        border_id: distributedBorderId,
      },
      updated_progress: {
        current_day: updatedProgress.current_day,
        claimed_days: updatedProgress.claimed_days,
      },
    };
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

