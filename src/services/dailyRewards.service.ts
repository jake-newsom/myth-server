import db from "../config/db.config";
import UserModel from "../models/user.model";
import * as cron from "node-cron";
import DailyShopService from "./dailyShop.service";
import MonthlyLoginRewardsService from "./monthlyLoginRewards.service";
import RiddleService from "./riddle.service";

interface DailyRewardResult {
  success: boolean;
  message: string;
  usersProcessed?: number;
  fateCoinsDistributed?: number;
  packsDistributed?: number;
  error?: string;
}

const DailyRewardsService = {
  /**
   * Distribute fate coins to all eligible users (those with fewer than 2 fate coins)
   */
  async distributeFateCoins(): Promise<{
    success: boolean;
    usersProcessed: number;
    coinsDistributed: number;
    error?: string;
  }> {
    try {
      console.log("🪙 Starting fate coin distribution...");

      // Get all users who have fewer than 2 fate coins
      const eligibleUsersQuery = `
        SELECT user_id, username, fate_coins 
        FROM users 
        WHERE fate_coins < 2
      `;

      const { rows: eligibleUsers } = await db.query(eligibleUsersQuery);

      if (eligibleUsers.length === 0) {
        console.log("✅ No users eligible for fate coin rewards");
        return {
          success: true,
          usersProcessed: 0,
          coinsDistributed: 0,
        };
      }

      console.log(
        `📊 Found ${eligibleUsers.length} users eligible for fate coins`
      );

      let totalCoinsDistributed = 0;
      let usersProcessed = 0;

      // Process each eligible user
      for (const user of eligibleUsers) {
        try {
          // Give 1 fate coin to bring them closer to the cap of 2
          const coinsToGive = Math.min(1, 2 - user.fate_coins);

          if (coinsToGive > 0) {
            const result = await UserModel.updateFateCoins(
              user.user_id,
              coinsToGive
            );

            if (result) {
              totalCoinsDistributed += coinsToGive;
              usersProcessed++;
              console.log(
                `💰 Gave ${coinsToGive} fate coin(s) to ${user.username} (${user.user_id})`
              );
            } else {
              console.error(
                `❌ Failed to update fate coins for user ${user.username}`
              );
            }
          }
        } catch (userError) {
          console.error(
            `❌ Error processing fate coins for user ${user.username}:`,
            userError
          );
        }
      }

      console.log(
        `✅ Fate coin distribution complete: ${usersProcessed} users processed, ${totalCoinsDistributed} coins distributed`
      );

      return {
        success: true,
        usersProcessed,
        coinsDistributed: totalCoinsDistributed,
      };
    } catch (error) {
      console.error("❌ Error during fate coin distribution:", error);
      return {
        success: false,
        usersProcessed: 0,
        coinsDistributed: 0,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },

  /**
   * Distribute packs to all eligible users (those with fewer than 2 packs)
   */
  async distributePacks(): Promise<{
    success: boolean;
    usersProcessed: number;
    packsDistributed: number;
    error?: string;
  }> {
    try {
      console.log("📦 Starting pack distribution...");

      // Get all users who have fewer than 2 packs
      const eligibleUsersQuery = `
        SELECT user_id, username, pack_count 
        FROM users 
        WHERE pack_count < 2
      `;

      const { rows: eligibleUsers } = await db.query(eligibleUsersQuery);

      if (eligibleUsers.length === 0) {
        console.log("✅ No users eligible for pack rewards");
        return {
          success: true,
          usersProcessed: 0,
          packsDistributed: 0,
        };
      }

      console.log(`📊 Found ${eligibleUsers.length} users eligible for packs`);

      let totalPacksDistributed = 0;
      let usersProcessed = 0;

      // Process each eligible user
      for (const user of eligibleUsers) {
        try {
          // Give 1 pack to bring them closer to the cap of 2
          const packsToGive = Math.min(1, 2 - user.pack_count);

          if (packsToGive > 0) {
            const result = await UserModel.addPacks(user.user_id, packsToGive);

            if (result) {
              totalPacksDistributed += packsToGive;
              usersProcessed++;
              console.log(
                `📦 Gave ${packsToGive} pack(s) to ${user.username} (${user.user_id})`
              );
            } else {
              console.error(
                `❌ Failed to update packs for user ${user.username}`
              );
            }
          }
        } catch (userError) {
          console.error(
            `❌ Error processing packs for user ${user.username}:`,
            userError
          );
        }
      }

      console.log(
        `✅ Pack distribution complete: ${usersProcessed} users processed, ${totalPacksDistributed} packs distributed`
      );

      return {
        success: true,
        usersProcessed,
        packsDistributed: totalPacksDistributed,
      };
    } catch (error) {
      console.error("❌ Error during pack distribution:", error);
      return {
        success: false,
        usersProcessed: 0,
        packsDistributed: 0,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },

  /**
   * Run the complete daily rewards distribution (both fate coins and packs)
   */
  async runDailyRewards(): Promise<DailyRewardResult> {
    try {
      console.log("🎁 Starting 12-hour rewards distribution...");
      const startTime = new Date();

      // Distribute fate coins
      const fateCoinsResult = await this.distributeFateCoins();

      // Distribute packs
      const packsResult = await this.distributePacks();

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      const totalUsersProcessed = Math.max(
        fateCoinsResult.usersProcessed,
        packsResult.usersProcessed
      );

      console.log(`🎉 12-hour rewards distribution completed in ${duration}ms`);
      console.log(
        `📊 Summary: ${fateCoinsResult.coinsDistributed} fate coins and ${packsResult.packsDistributed} packs distributed`
      );

      return {
        success: fateCoinsResult.success && packsResult.success,
        message: `Successfully distributed ${fateCoinsResult.coinsDistributed} fate coins and ${packsResult.packsDistributed} packs to eligible users`,
        usersProcessed: totalUsersProcessed,
        fateCoinsDistributed: fateCoinsResult.coinsDistributed,
        packsDistributed: packsResult.packsDistributed,
      };
    } catch (error) {
      console.error("❌ Error during daily rewards distribution:", error);
      return {
        success: false,
        message: "Failed to distribute daily rewards",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },

  /**
   * Start the automated daily rewards and shop scheduler
   * Runs at 12:00 AM and 12:00 PM UTC daily
   */
  startDailyRewardsScheduler(): cron.ScheduledTask[] {
    console.log(
      "🕒 Starting daily rewards and shop scheduler (12:00 AM & 12:00 PM UTC)"
    );

    const tasks: cron.ScheduledTask[] = [];

    // Schedule for 12:00 AM UTC (midnight) - Daily shop refresh and rewards
    // Open this week's riddle on boot if the Wednesday run was missed (deploy, downtime).
    RiddleService.rotateWeek().catch((err) =>
      console.error("❌ Error rotating weekly riddle on startup:", err)
    );

    const midnightTask = cron.schedule(
      "0 0 * * *",
      async () => {
        console.log("🌙 Running midnight UTC scheduled tasks...");

        try {
          // Check if it's the 1st of the month and reset monthly login progress
          const now = new Date();
          const isFirstOfMonth = now.getUTCDate() === 1;

          // Weekly Riddle opens Wednesdays; idempotent, so daily runs also catch up a missed week.
          try {
            await RiddleService.rotateWeek(now);
          } catch (riddleError) {
            console.error("❌ Error rotating weekly riddle:", riddleError);
          }
          
          if (isFirstOfMonth) {
            console.log("📅 First of the month detected - resetting monthly login progress...");
            try {
              const resetCount = await MonthlyLoginRewardsService.resetMonthlyProgress();
              console.log(`✅ Monthly login progress reset complete. ${resetCount} records deleted.`);
            } catch (resetError) {
              console.error("❌ Error resetting monthly login progress:", resetError);
            }
          }

          // Generate new daily shop offerings
          await DailyShopService.generateDailyOfferings();
          console.log("🏪 Daily shop offerings refreshed for new day");

          // Run daily rewards distribution
          const result = await this.runDailyRewards();
          if (result.success) {
            console.log(
              `✅ Midnight daily rewards completed: ${result.message}`
            );
          } else {
            console.error(
              `❌ Midnight daily rewards failed: ${result.message}`
            );
          }
        } catch (error) {
          console.error("❌ Error in midnight scheduled tasks:", error);
        }
      },
      {
        timezone: "UTC",
      }
    );

    // Schedule for 12:00 PM UTC (noon) - Additional rewards distribution
    const noonTask = cron.schedule(
      "0 12 * * *",
      async () => {
        console.log("☀️ Running noon UTC scheduled tasks...");

        try {
          // Run daily rewards distribution
          const result = await this.runDailyRewards();
          if (result.success) {
            console.log(`✅ Noon daily rewards completed: ${result.message}`);
          } else {
            console.error(`❌ Noon daily rewards failed: ${result.message}`);
          }
        } catch (error) {
          console.error("❌ Error in noon scheduled tasks:", error);
        }
      },
      {
        timezone: "UTC",
      }
    );

    tasks.push(midnightTask, noonTask);

    console.log("✅ Daily rewards and shop scheduler started successfully");
    return tasks;
  },

  /**
   * Stop the automated daily rewards scheduler
   */
  stopDailyRewardsScheduler(tasks: cron.ScheduledTask[]): void {
    console.log("🛑 Stopping daily rewards and shop scheduler");
    tasks.forEach((task) => {
      if (task) {
        task.stop();
        task.destroy();
      }
    });
  },
};

export default DailyRewardsService;
