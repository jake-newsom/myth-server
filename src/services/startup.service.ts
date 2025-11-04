import DailyShopService from "./dailyShop.service";
import DailyShopModel from "../models/dailyShop.model";
import { logger } from "../utils/logger";

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
   * Run all startup initialization tasks
   */
  async initialize(): Promise<void> {
    logger.info("🚀 Running startup initialization...");

    try {
      await this.initializeDailyShop();
      logger.info("✅ Startup initialization completed successfully");
    } catch (error) {
      logger.error("❌ Startup initialization failed:", error as any);
      // Don't throw - let the server continue running
    }
  },
};

export default StartupService;
