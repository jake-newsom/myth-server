import DailyTaskModel, {
  DailyTaskDefinition,
  DailyTaskWithProgress,
  UserDailyTaskProgress,
} from "../models/dailyTask.model";
import UserModel from "../models/user.model";
import RewardService from "./reward.service";
import db from "../config/db.config";
import logger from "../utils/logger";
import { RewardItem } from "../types/service.types";

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
  reward?: {
    gems?: number;
    cards?: number;
    packs?: number;
    card_details?: any;
  };
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
      logger.error(
        "Error getting daily task status:",
        {},
        error instanceof Error ? error : new Error(String(error))
      );
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
        return {
          success: false,
          error: "Could not retrieve daily task status",
        };
      }

      // Find next claimable reward
      const nextReward = status.rewards.find((r) => r.eligible && !r.claimed);
      if (!nextReward) {
        return { success: false, error: "No rewards available to claim" };
      }

      const tier = nextReward.tier;
      const rewardConfig = REWARD_TIERS[tier - 1];

      const items: RewardItem[] = [];
      if (rewardConfig.gems > 0) {
        items.push({ type: "gems", amount: rewardConfig.gems });
      }
      if (rewardConfig.packs > 0) {
        items.push({ type: "packs", amount: rewardConfig.packs });
      }

      // Card tiers grant a random low-rarity card. We resolve the random card
      // (and capture its display metadata) outside RewardService so the API can
      // return the card details, but we let RewardService perform the actual
      // INSERT in its bulk path.
      let cardDetails: {
        card_id: string;
        name: string;
        rarity: string;
        image_url: string;
      } | null = null;
      if (rewardConfig.cards > 0) {
        cardDetails = await this.pickRandomCardForDailyTask();
        if (cardDetails) {
          items.push({ type: "card", card_variant_id: cardDetails.card_id });
        }
      }

      const grantResult = await RewardService.grantRewards(userId, items);
      if (!grantResult.success) {
        return {
          success: false,
          error: grantResult.error || "Failed to apply rewards",
        };
      }

      const grantedCard = grantResult.granted.find(
        (g) => g.item.type === "card"
      );
      const userCardInstanceId = grantedCard?.user_card_instance_id;

      await DailyTaskModel.setRewardsClaimed(userId, tier);

      return {
        success: true,
        tier,
        reward: {
          ...(rewardConfig.gems > 0 && { gems: rewardConfig.gems }),
          ...(rewardConfig.cards > 0 && {
            cards: rewardConfig.cards,
            card_details: cardDetails
              ? { ...cardDetails, user_card_instance_id: userCardInstanceId }
              : null,
          }),
          ...(rewardConfig.packs > 0 && { packs: rewardConfig.packs }),
        },
        new_balances: {
          gems: grantResult.updated_currencies?.gems ?? 0,
          pack_count: grantResult.updated_currencies?.pack_count ?? 0,
        },
      };
    } catch (error) {
      logger.error(
        "Error claiming daily task reward:",
        {},
        error instanceof Error ? error : new Error(String(error))
      );
      return { success: false, error: "Failed to claim reward" };
    }
  },

  /**
   * Pick a random low-rarity, non-exclusive card variant for daily-task card
   * tiers. Returns just the display metadata; the actual INSERT into
   * user_owned_cards is performed by RewardService.
   */
  async pickRandomCardForDailyTask(): Promise<{
    card_id: string;
    name: string;
    rarity: string;
    image_url: string;
  } | null> {
    try {
      const countQuery = `
        SELECT COUNT(*)::int as total
        FROM card_variants cv
        JOIN characters ch ON ch.character_id = cv.character_id
        WHERE cv.rarity IN ('common', 'uncommon', 'rare')
          AND cv.is_exclusive = false
          AND cv.released_at <= NOW()
          AND ch.released_at <= NOW();
      `;
      const { rows: countRows } = await db.query(countQuery);
      const total = Number(countRows[0]?.total || 0);
      if (total === 0) {
        return null;
      }

      const randomOffset = Math.floor(Math.random() * total);
      const query = `
        SELECT cv.card_variant_id as card_id, ch.name, cv.rarity, cv.image_url
        FROM card_variants cv
        JOIN characters ch ON cv.character_id = ch.character_id
        WHERE cv.rarity IN ('common', 'uncommon', 'rare')
          AND cv.is_exclusive = false
          AND cv.released_at <= NOW()
          AND ch.released_at <= NOW()
        ORDER BY cv.card_variant_id
        LIMIT 1 OFFSET $1;
      `;
      const { rows } = await db.query(query, [randomOffset]);
      if (rows.length === 0) {
        return null;
      }

      const card = rows[0];
      return {
        card_id: card.card_id,
        name: card.name,
        rarity: card.rarity,
        image_url: card.image_url,
      };
    } catch (error) {
      logger.error(
        "Error picking random card for daily task:",
        {},
        error instanceof Error ? error : new Error(String(error))
      );
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
      const activeTasks = await DailyTaskModel.getActiveTodayTasksByType(
        trackingType
      );
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
        await DailyTaskModel.incrementTaskProgress(
          userId,
          task.task_key,
          amount
        );
        logger.debug(
          `Daily task progress: ${task.task_key} +${amount} for user ${userId}`
        );
      }
    } catch (error) {
      logger.error(
        "Error tracking daily task progress:",
        {},
        error instanceof Error ? error : new Error(String(error))
      );
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
  async trackDefeatWithMythology(
    userId: string,
    setId: string,
    count: number = 1
  ): Promise<void> {
    try {
      // Get mythology slug from set_id
      const query = `SELECT name FROM sets WHERE set_id = $1`;
      const { rows } = await db.query(query, [setId]);

      if (rows.length === 0) {
        logger.debug(`Set not found for set_id: ${setId}`);
        return;
      }

      const mythology = rows[0].name.toLowerCase();
      await this.trackProgress(
        userId,
        "defeat_mythology",
        { mythology },
        count
      );
    } catch (error) {
      logger.error(
        "Error tracking defeat with mythology:",
        {},
        error instanceof Error ? error : new Error(String(error))
      );
    }
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
      logger.error(
        "Error ensuring daily task selection:",
        {},
        error instanceof Error ? error : new Error(String(error))
      );
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
      logger.info(
        `Daily task selection created for ${tomorrowStr}:`,
        selection.selected_task_keys
      );
    } catch (error) {
      logger.error(
        "Error generating tomorrow's daily task selection:",
        {},
        error instanceof Error ? error : new Error(String(error))
      );
    }
  },
};

export default DailyTaskService;
