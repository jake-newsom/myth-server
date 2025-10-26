/**
 * Test script for Daily Rewards Service
 * 
 * This script tests the daily rewards functionality by:
 * 1. Checking current user states
 * 2. Running the daily rewards distribution
 * 3. Verifying the results
 * 
 * Usage: node scripts/test-daily-rewards.js
 */

require("dotenv").config();
const DailyRewardsService = require("../dist/services/dailyRewards.service").default;
const db = require("../dist/config/db.config").default;

async function testDailyRewards() {
  console.log("🧪 Testing Daily Rewards Service...\n");

  try {
    // 1. Check current state of users
    console.log("📊 Checking current user states...");
    const usersQuery = `
      SELECT 
        user_id, 
        username, 
        fate_coins, 
        pack_count,
        CASE 
          WHEN fate_coins < 2 THEN 'eligible for fate coins'
          ELSE 'not eligible for fate coins'
        END as fate_coin_status,
        CASE 
          WHEN pack_count < 2 THEN 'eligible for packs'
          ELSE 'not eligible for packs'
        END as pack_status
      FROM users 
      ORDER BY username 
      LIMIT 10;
    `;
    
    const { rows: usersBefore } = await db.query(usersQuery);
    
    console.log("Current user states (first 10 users):");
    console.table(usersBefore);

    // Count eligible users
    const eligibleFateCoinsQuery = `SELECT COUNT(*) as count FROM users WHERE fate_coins < 2`;
    const eligiblePacksQuery = `SELECT COUNT(*) as count FROM users WHERE pack_count < 2`;
    
    const { rows: [fateCoinsEligible] } = await db.query(eligibleFateCoinsQuery);
    const { rows: [packsEligible] } = await db.query(eligiblePacksQuery);
    
    console.log(`\n📈 Eligible users:`);
    console.log(`  - Fate coins: ${fateCoinsEligible.count} users`);
    console.log(`  - Packs: ${packsEligible.count} users`);

    // 2. Run the daily rewards distribution
    console.log("\n🎁 Running daily rewards distribution...");
    const result = await DailyRewardsService.runDailyRewards();

    console.log("\n📋 Distribution Results:");
    console.log(`  Success: ${result.success}`);
    console.log(`  Message: ${result.message}`);
    if (result.usersProcessed !== undefined) {
      console.log(`  Users processed: ${result.usersProcessed}`);
    }
    if (result.fateCoinsDistributed !== undefined) {
      console.log(`  Fate coins distributed: ${result.fateCoinsDistributed}`);
    }
    if (result.packsDistributed !== undefined) {
      console.log(`  Packs distributed: ${result.packsDistributed}`);
    }
    if (result.error) {
      console.log(`  Error: ${result.error}`);
    }

    // 3. Check state after distribution
    console.log("\n📊 Checking user states after distribution...");
    const { rows: usersAfter } = await db.query(usersQuery);
    
    console.log("User states after distribution (first 10 users):");
    console.table(usersAfter);

    // Compare before and after
    console.log("\n🔍 Changes detected:");
    let changesFound = false;
    
    for (let i = 0; i < Math.min(usersBefore.length, usersAfter.length); i++) {
      const before = usersBefore[i];
      const after = usersAfter[i];
      
      if (before.fate_coins !== after.fate_coins || before.pack_count !== after.pack_count) {
        console.log(`  ${after.username}:`);
        if (before.fate_coins !== after.fate_coins) {
          console.log(`    Fate coins: ${before.fate_coins} → ${after.fate_coins}`);
        }
        if (before.pack_count !== after.pack_count) {
          console.log(`    Packs: ${before.pack_count} → ${after.pack_count}`);
        }
        changesFound = true;
      }
    }
    
    if (!changesFound) {
      console.log("  No changes detected (all users already at maximum rewards)");
    }

    console.log("\n✅ Daily Rewards Service test completed successfully!");

  } catch (error) {
    console.error("❌ Error during daily rewards test:", error);
    process.exit(1);
  } finally {
    // Close database connection
    await db.end();
  }
}

// Run the test
testDailyRewards();
