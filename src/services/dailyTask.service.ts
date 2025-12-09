import DailyTaskModel, {
  DailyTaskDefinition,
  DailyTaskWithProgress,
  UserDailyTaskProgress,
} from "../models/dailyTask.model";
import UserModel from "../models/user.model";
import db from "../config/db.config";
import logger from "../utils/logger";

// Reward tiers
const REWARD_TIERS = [
  { tier: 1, gems: 25, cards: 0, packs: 0 },
  { tier: 2, gems: 25, cards: 0, packs: 0 },
  { tier: 3, gems: 0, cards: 1, packs: 0 },
  { tier: 4, gems: 50, cards: 0, packs: 0 },
  { tier: 5, gems: 0, cards: 0, packs: 1 },
];

interface DailyTaskStatus {
  date: string;
  tasks: DailyTaskWithProgress[];
  completed_count: number;
  rewards: Array<{
    tier: number;
    claimed: boolean;
    eligible: boolean;
    reward: { gems?: number; cards?: number; packs?: number };
  }>;
}

interface ClaimRewardResult {
  success: boolean;
  tier?: number;
  reward?: { gems?: number; cards?: number; packs?: number; card_details?: any };
  new_balances?: { gems: number; pack_count: number };
  error?: string;
}

const DailyTaskService = {
  /**
   * Get user's daily task status
   */
  async getDailyTaskStatus(userId: string): Promise<DailyTaskStatus | null> {
    try {
      // Ensure today's selection exists
      await DailyTaskModel.createDailySelection();

      // Get tasks with progress
      const tasks = await DailyTaskModel.getTodayTasksWithProgress(userId);
      if (tasks.length === 0) {
        return null;
      }

      // Get user progress for rewards claimed
      const progress = await DailyTaskModel.getOrCreateUserProgress(userId);
      const completedCount = tasks.filter((t) => t.completed).length;

      // Build rewards status
      const rewards = REWARD_TIERS.map((rewardTier) => ({
        tier: rewardTier.tier,
        claimed: progress.rewards_claimed >= rewardTier.tier,
        eligible: completedCount >= rewardTier.tier,
        reward: {
          ...(rewardTier.gems > 0 && { gems: rewardTier.gems }),
          ...(rewardTier.cards > 0 && { cards: rewardTier.cards }),
          ...(rewardTier.packs > 0 && { packs: rewardTier.packs }),
        },
      }));

      return {
        date: new Date().toISOString().split("T")[0],
        tasks,
        completed_count: completedCount,
        rewards,
      };
    } catch (error) {
      logger.error("Error getting daily task status:", {}, error instanceof Error ? error : new Error(String(error)));
      return null;
    }
  },

  /**
   * Claim the next available reward tier
   */
  async claimReward(userId: string): Promise<ClaimRewardResult> {
    try {
      // Get current status
      const status = await this.getDailyTaskStatus(userId);
      if (!status) {
        return { success: false, error: "Could not retrieve daily task status" };
      }

      // Find next claimable reward
      const nextReward = status.rewards.find((r) => r.eligible && !r.claimed);
      if (!nextReward) {
        return { success: false, error: "No rewards available to claim" };
      }

      const tier = nextReward.tier;
      const rewardConfig = REWARD_TIERS[tier - 1];

      // Award rewards
      let cardDetails = null;

      if (rewardConfig.gems > 0) {
        await UserModel.updateGems(userId, rewardConfig.gems);
      }

      if (rewardConfig.packs > 0) {
        await UserModel.addPacks(userId, rewardConfig.packs);
      }

      if (rewardConfig.cards > 0) {
        // Award a random card
        cardDetails = await this.awardRandomCard(userId);
      }

      // Update claimed tier
      await DailyTaskModel.setRewardsClaimed(userId, tier);

      // Get updated balances
      const user = await UserModel.findById(userId);

      return {
        success: true,
        tier,
        reward: {
          ...(rewardConfig.gems > 0 && { gems: rewardConfig.gems }),
          ...(rewardConfig.cards > 0 && { cards: rewardConfig.cards, card_details: cardDetails }),
          ...(rewardConfig.packs > 0 && { packs: rewardConfig.packs }),
        },
        new_balances: {
          gems: user?.gems || 0,
          pack_count: user?.pack_count || 0,
        },
      };
    } catch (error) {
      logger.error("Error claiming daily task reward:", {}, error instanceof Error ? error : new Error(String(error)));
      return { success: false, error: "Failed to claim reward" };
    }
  },

  /**
   * Award a random card to user
   */
  async awardRandomCard(userId: string): Promise<any> {
    try {
      // Get a random common/uncommon card
      const query = `
        SELECT card_id, name, rarity, image_url
        FROM cards
        WHERE rarity IN ('common', 'uncommon', 'rare')
        ORDER BY RANDOM()
        LIMIT 1;
      `;
      const { rows } = await db.query(query);
      if (rows.length === 0) {
        return null;
      }

      const card = rows[0];

      // Add to user's collection
      const insertQuery = `
        INSERT INTO user_owned_cards (user_id, card_id, level, xp)
        VALUES ($1, $2, 1, 0)
        RETURNING user_card_instance_id;
      `;
      const { rows: insertRows } = await db.query(insertQuery, [userId, card.card_id]);

      return {
        card_id: card.card_id,
        name: card.name,
        rarity: card.rarity,
        image_url: card.image_url,
        user_card_instance_id: insertRows[0]?.user_card_instance_id,
      };
    } catch (error) {
      logger.error("Error awarding random card:", {}, error instanceof Error ? error : new Error(String(error)));
      return null;
    }
  },

  /**
   * Track progress for a specific event type
   */
  async trackProgress(
    userId: string,
    trackingType: string,
    metadata?: Record<string, any>,
    amount: number = 1
  ): Promise<void> {
    try {
      // Get active tasks for this tracking type
      const activeTasks = await DailyTaskModel.getActiveTodayTasksByType(trackingType);
      if (activeTasks.length === 0) {
        return;
      }

      for (const task of activeTasks) {
        // Check if metadata matches (for mythology-specific tasks)
        if (trackingType === "defeat_mythology") {
          const requiredMythology = task.tracking_metadata?.mythology;
          const actualMythology = metadata?.mythology;
          if (requiredMythology && requiredMythology !== actualMythology) {
            continue;
          }
        }

        // Increment progress
        await DailyTaskModel.incrementTaskProgress(userId, task.task_key, amount);
        logger.debug(`Daily task progress: ${task.task_key} +${amount} for user ${userId}`);
      }
    } catch (error) {
      logger.error("Error tracking daily task progress:", {}, error instanceof Error ? error : new Error(String(error)));
    }
  },

  /**
   * Track a fate pick completion
   */
  async trackFatePick(userId: string): Promise<void> {
    await this.trackProgress(userId, "fate_pick");
  },

  /**
   * Track a pack opening
   */
  async trackPackOpen(userId: string, count: number = 1): Promise<void> {
    await this.trackProgress(userId, "pack_open", undefined, count);
  },

  /**
   * Track a card defeat (generic)
   */
  async trackDefeat(userId: string, count: number = 1): Promise<void> {
    await this.trackProgress(userId, "defeat", undefined, count);
  },

  /**
   * Track a card defeat with mythology
   */
  async trackDefeatWithMythology(userId: string, mythology: string, count: number = 1): Promise<void> {
    await this.trackProgress(userId, "defeat_mythology", { mythology }, count);
  },

  /**
   * Track a match win
   */
  async trackWin(userId: string): Promise<void> {
    await this.trackProgress(userId, "win");
  },

  /**
   * Track a card level up
   */
  async trackLevelUp(userId: string): Promise<void> {
    await this.trackProgress(userId, "level_up");
  },

  /**
   * Track a curse applied
   */
  async trackCurse(userId: string, count: number = 1): Promise<void> {
    await this.trackProgress(userId, "curse", undefined, count);
  },

  /**
   * Track a card destroyed
   */
  async trackDestroy(userId: string, count: number = 1): Promise<void> {
    await this.trackProgress(userId, "destroy", undefined, count);
  },

  /**
   * Track a bless applied
   */
  async trackBless(userId: string, count: number = 1): Promise<void> {
    await this.trackProgress(userId, "bless", undefined, count);
  },

  /**
   * Create or ensure today's daily task selection exists
   */
  async ensureTodaySelection(): Promise<void> {
    try {
      await DailyTaskModel.createDailySelection();
      logger.info("Daily task selection ensured for today");
    } catch (error) {
      logger.error("Error ensuring daily task selection:", {}, error instanceof Error ? error : new Error(String(error)));
    }
  },

  /**
   * Generate selection for tomorrow (used by scheduler)
   */
  async generateTomorrowSelection(): Promise<void> {
    try {
      const tomorrow = new Date();
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split("T")[0];

      const selection = await DailyTaskModel.createDailySelection(tomorrowStr);
      logger.info(`Daily task selection created for ${tomorrowStr}:`, selection.selected_task_keys);
    } catch (error) {
      logger.error("Error generating tomorrow's daily task selection:", {}, error instanceof Error ? error : new Error(String(error)));
    }
  },
};

export default DailyTaskService;

