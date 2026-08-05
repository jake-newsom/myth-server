import DailyShopService from "./dailyShop.service";
import DailyShopModel from "../models/dailyShop.model";
import ChatModel from "../models/chat.model";
import { CHAT_CONFIG } from "../config/constants";
import { logger } from "../utils/logger";

/** Handle for the chat retention sweeper, so it can be stopped in tests. */
let chatRetentionTimer: NodeJS.Timeout | null = null;

const StartupService = {
  /**
   * Initialize daily shop on server startup
   * Ensures shop configuration exists and generates today's offerings if missing
   */
  async initializeDailyShop(): Promise<void> {
    try {
      logger.info("🏪 Initializing daily shop on startup...");

      // Check if shop configuration exists
      const configs = await DailyShopModel.getShopConfig();
      if (configs.length === 0) {
        logger.warn(
          "⚠️ No shop configuration found. Shop will not function until configured."
        );
        return;
      }

      logger.info(`✅ Found ${configs.length} shop configurations`);

      // Check if today's offerings exist
      const shopDate = DailyShopService.getCurrentShopDate();
      const offerings = await DailyShopModel.getTodaysOfferings(shopDate);

      if (offerings.length === 0) {
        logger.info(`🔧 No offerings found for ${shopDate}, generating now...`);

        try {
          await DailyShopService.generateDailyOfferings(shopDate);

          // Verify offerings were created
          const newOfferings = await DailyShopModel.getTodaysOfferings(
            shopDate
          );
          logger.info(
            `🎉 Generated ${newOfferings.length} daily shop offerings for ${shopDate}`
          );
        } catch (error) {
          logger.error(
            "❌ Failed to generate daily shop offerings:",
            error as any
          );
          // Don't throw - let the server continue running
        }
      } else {
        logger.info(
          `✅ Found ${offerings.length} existing offerings for ${shopDate}`
        );
      }
    } catch (error) {
      logger.error("❌ Error initializing daily shop:", error as any);
      // Don't throw - let the server continue running even if shop init fails
    }
  },

  /**
   * Delete chat messages past the retention window.
   *
   * Retention exists only for moderation, support and analytics -- the client
   * never backfills history -- so the window is deliberately short. Rows that
   * a moderator soft-deleted, and rows authored by a currently-muted user, are
   * exempted by the model as an audit trail for open cases.
   */
  async sweepChatRetention(): Promise<void> {
    try {
      const removed = await ChatModel.sweepExpired();
      if (removed > 0) {
        logger.info(
          `🧹 Chat retention sweep removed ${removed} message(s) older than ${CHAT_CONFIG.RETENTION_DAYS} days`
        );
      }
    } catch (error) {
      logger.error("❌ Chat retention sweep failed:", error as any);
      // Don't throw - a failed sweep must not affect the running server.
    }
  },

  /**
   * Start the periodic chat retention sweeper. Runs once at startup and then
   * on a fixed interval.
   */
  startChatRetentionSweeper(): void {
    if (chatRetentionTimer) return;

    void this.sweepChatRetention();

    chatRetentionTimer = setInterval(() => {
      void this.sweepChatRetention();
    }, CHAT_CONFIG.RETENTION_SWEEP_INTERVAL_MS);

    // Don't hold the process open just for the sweeper.
    chatRetentionTimer.unref?.();

    logger.info(
      `🧹 Chat retention sweeper started (every ${
        CHAT_CONFIG.RETENTION_SWEEP_INTERVAL_MS / 3_600_000
      }h, keeping ${CHAT_CONFIG.RETENTION_DAYS} days)`
    );
  },

  stopChatRetentionSweeper(): void {
    if (!chatRetentionTimer) return;
    clearInterval(chatRetentionTimer);
    chatRetentionTimer = null;
  },

  /**
   * Run all startup initialization tasks
   */
  async initialize(): Promise<void> {
    logger.info("🚀 Running startup initialization...");

    try {
      await this.initializeDailyShop();
      this.startChatRetentionSweeper();
      logger.info("✅ Startup initialization completed successfully");
    } catch (error) {
      logger.error("❌ Startup initialization failed:", error as any);
      // Don't throw - let the server continue running
    }
  },
};

export default StartupService;
