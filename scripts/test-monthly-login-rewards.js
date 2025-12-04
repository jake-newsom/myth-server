/**
 * Test script for Monthly Login Rewards Service
 * 
 * This script tests the monthly login rewards functionality by:
 * 1. Checking reward configuration
 * 2. Testing user progress tracking
 * 3. Testing reward claiming
 * 4. Testing month transition logic
 * 
 * Usage: node scripts/test-monthly-login-rewards.js [userId]
 */

require("dotenv").config();
const MonthlyLoginRewardsService = require("../dist/services/monthlyLoginRewards.service").default;
const MonthlyLoginRewardsModel = require("../dist/models/monthlyLoginRewards.model").default;
const UserModel = require("../dist/models/user.model").default;
const db = require("../dist/config/db.config").default;

async function testMonthlyLoginRewards() {
  console.log("🧪 Testing Monthly Login Rewards Service...\n");

  try {
    // Get test user ID from command line or use first user
    const userId = process.argv[2];
    
    if (!userId) {
      console.log("⚠️  No user ID provided. Using first available user...");
      const { rows } = await db.query("SELECT user_id, username FROM users LIMIT 1");
      if (rows.length === 0) {
        console.error("❌ No users found in database. Please create a user first.");
        process.exit(1);
      }
      const testUserId = rows[0].user_id;
      console.log(`✅ Using user: ${rows[0].username} (${testUserId})\n`);
      await runTests(testUserId);
    } else {
      // Verify user exists
      const user = await UserModel.findById(userId);
      if (!user) {
        console.error(`❌ User ${userId} not found.`);
        process.exit(1);
      }
      console.log(`✅ Using user: ${user.username} (${userId})\n`);
      await runTests(userId);
    }

  } catch (error) {
    console.error("❌ Error during monthly login rewards test:", error);
    process.exit(1);
  } finally {
    // Close database connection
    await db.end();
  }
}

async function runTests(userId) {
  // 1. Check reward configuration
  console.log("📋 Step 1: Checking reward configuration...");
  const configs = await MonthlyLoginRewardsService.getMonthlyRewardConfig();
  console.log(`✅ Found ${configs.length} reward configurations`);
  
  if (configs.length > 0) {
    console.log("\nSample rewards (first 6 days):");
    configs.slice(0, 6).forEach(config => {
      const rewardDesc = config.reward_type === 'enhanced_card' 
        ? '1 random enhanced card'
        : `${config.amount} ${config.reward_type}`;
      console.log(`  Day ${config.day}: ${rewardDesc}`);
    });
  }

  // 2. Get monthly login status
  console.log("\n📊 Step 2: Getting monthly login status...");
  const status = await MonthlyLoginRewardsService.getMonthlyLoginStatus(userId);
  console.log(`✅ Month: ${status.month_year}`);
  console.log(`✅ Current day: ${status.current_day}`);
  console.log(`✅ Claimed days: [${status.claimed_days.join(', ')}]`);
  console.log(`✅ Available days: [${status.available_days.join(', ')}]`);

  // 3. Test claiming a reward (if available)
  if (status.available_days.length > 0) {
    const dayToClaim = status.available_days[0];
    console.log(`\n🎁 Step 3: Claiming reward for day ${dayToClaim}...`);
    
    const rewardConfig = status.rewards.find(r => r.day === dayToClaim);
    if (rewardConfig) {
      console.log(`  Reward: ${rewardConfig.amount} ${rewardConfig.reward_type}`);
    }

    // Get user state before
    const userBefore = await UserModel.findById(userId);
    console.log(`\n  User state before:`);
    console.log(`    Gems: ${userBefore?.gems || 0}`);
    console.log(`    Fate coins: ${userBefore?.fate_coins || 0}`);
    console.log(`    Card fragments: ${userBefore?.card_fragments || 0}`);
    console.log(`    Packs: ${userBefore?.pack_count || 0}`);

    try {
      const claimResult = await MonthlyLoginRewardsService.claimDailyReward(userId, dayToClaim);
      console.log(`\n✅ Successfully claimed reward!`);
      console.log(`  Message: ${claimResult.message}`);
      console.log(`  Reward: ${claimResult.reward.amount} ${claimResult.reward.reward_type}`);
      console.log(`  Updated current day: ${claimResult.updated_progress.current_day}`);
      console.log(`  Updated claimed days: [${claimResult.updated_progress.claimed_days.join(', ')}]`);

      // Get user state after
      const userAfter = await UserModel.findById(userId);
      console.log(`\n  User state after:`);
      console.log(`    Gems: ${userAfter?.gems || 0}`);
      console.log(`    Fate coins: ${userAfter?.fate_coins || 0}`);
      console.log(`    Card fragments: ${userAfter?.card_fragments || 0}`);
      console.log(`    Packs: ${userAfter?.pack_count || 0}`);

      // Show changes
      if (userBefore && userAfter) {
        console.log(`\n  Changes:`);
        if (userBefore.gems !== userAfter.gems) {
          console.log(`    Gems: ${userBefore.gems} → ${userAfter.gems} (+${userAfter.gems - userBefore.gems})`);
        }
        if (userBefore.fate_coins !== userAfter.fate_coins) {
          console.log(`    Fate coins: ${userBefore.fate_coins} → ${userAfter.fate_coins} (+${userAfter.fate_coins - userBefore.fate_coins})`);
        }
        if (userBefore.card_fragments !== userAfter.card_fragments) {
          console.log(`    Card fragments: ${userBefore.card_fragments} → ${userAfter.card_fragments} (+${userAfter.card_fragments - userBefore.card_fragments})`);
        }
        if (userBefore.pack_count !== userAfter.pack_count) {
          console.log(`    Packs: ${userBefore.pack_count} → ${userAfter.pack_count} (+${userAfter.pack_count - userBefore.pack_count})`);
        }
      }
    } catch (error) {
      console.error(`  ❌ Error claiming reward: ${error.message}`);
    }
  } else {
    console.log("\n⚠️  Step 3: No available rewards to claim");
    console.log("  (All rewards claimed or current day hasn't reached claimable days)");
  }

  // 4. Test invalid claim attempts
  console.log("\n🔍 Step 4: Testing invalid claim attempts...");
  
  // Try claiming already claimed day
  if (status.claimed_days.length > 0) {
    const alreadyClaimedDay = status.claimed_days[0];
    try {
      await MonthlyLoginRewardsService.claimDailyReward(userId, alreadyClaimedDay);
      console.error(`  ❌ Should have failed for already claimed day ${alreadyClaimedDay}`);
    } catch (error) {
      console.log(`  ✅ Correctly rejected already claimed day ${alreadyClaimedDay}: ${error.message}`);
    }
  }

  // Try claiming invalid day
  try {
    await MonthlyLoginRewardsService.claimDailyReward(userId, 25);
    console.error(`  ❌ Should have failed for invalid day 25`);
  } catch (error) {
    console.log(`  ✅ Correctly rejected invalid day 25: ${error.message}`);
  }

  // 5. Test month transition (simulate by checking reset function)
  console.log("\n🔄 Step 5: Testing monthly reset function...");
  try {
    const resetCount = await MonthlyLoginRewardsService.resetMonthlyProgress();
    console.log(`  ✅ Reset function works (would delete ${resetCount} records)`);
    console.log(`  ⚠️  Note: This actually reset all progress. Re-running setup may be needed.`);
  } catch (error) {
    console.error(`  ❌ Error testing reset: ${error.message}`);
  }

  console.log("\n✅ Monthly Login Rewards Service test completed!");
}

// Run the test
testMonthlyLoginRewards();

