import db from "../config/db.config";
import UserModel from "../models/user.model";

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
   * Start the automated daily rewards scheduler
   * Runs every 12 hours (43200000 milliseconds)
   */
  startDailyRewardsScheduler(): NodeJS.Timeout {
    console.log("🕒 Starting daily rewards scheduler (every 12 hours)");

    // Run immediately on startup (optional - commented out to avoid giving rewards on every restart)
    // this.runDailyRewards();

    // Set up interval for every 12 hours (12 * 60 * 60 * 1000 milliseconds)
    const intervalId = setInterval(async () => {
      console.log("⏰ Running scheduled daily rewards distribution...");
      const result = await this.runDailyRewards();

      if (result.success) {
        console.log(`✅ Scheduled daily rewards completed: ${result.message}`);
      } else {
        console.error(`❌ Scheduled daily rewards failed: ${result.message}`);
      }
    }, 12 * 60 * 60 * 1000); // 12 hours

    return intervalId;
  },

  /**
   * Stop the automated daily rewards scheduler
   */
  stopDailyRewardsScheduler(intervalId: NodeJS.Timeout): void {
    console.log("🛑 Stopping daily rewards scheduler");
    clearInterval(intervalId);
  },
};

export default DailyRewardsService;
