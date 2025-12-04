// Load environment variables from .env file
require('dotenv').config();

const db = require("../dist/config/db.config.js").default;

/**
 * Setup default monthly login reward configuration
 * 4x6 day rotation pattern with increasing values each cycle
 */
async function setupMonthlyLoginConfig() {
  try {
    console.log("📅 Setting up monthly login reward configuration...");

    // Base pattern (6 days): 10 gems → 5 card fragments → 1 fate coin → 20 gems → 10 card fragments → 1 card pack
    const basePattern = [
      { reward_type: 'gems', amount: 10 },
      { reward_type: 'card_fragments', amount: 5 },
      { reward_type: 'fate_coins', amount: 1 },
      { reward_type: 'gems', amount: 20 },
      { reward_type: 'card_fragments', amount: 10 },
      { reward_type: 'card_pack', amount: 1 },
    ];

    // Cycle multipliers
    const cycles = [
      { multiplier: 1.0, name: 'Cycle 1' },    // Days 1-6: Base values
      { multiplier: 1.5, name: 'Cycle 2' },    // Days 7-12: ~1.5x
      { multiplier: 2.0, name: 'Cycle 3' },   // Days 13-18: ~2x
      { multiplier: 2.5, name: 'Cycle 4' },  // Days 19-24: ~2.5x + special final reward
    ];

    const rewards = [];

    // Generate rewards for each cycle
    for (let cycleIndex = 0; cycleIndex < cycles.length; cycleIndex++) {
      const cycle = cycles[cycleIndex];
      const startDay = cycleIndex * 6 + 1;
      
      for (let dayIndex = 0; dayIndex < basePattern.length; dayIndex++) {
        const day = startDay + dayIndex;
        const baseReward = basePattern[dayIndex];
        
        // Special handling for day 24 (final day) - enhanced card instead of pack
        if (day === 24) {
          rewards.push({
            day: 24,
            reward_type: 'enhanced_card',
            amount: 1, // 1 random enhanced card
            card_id: null, // Random selection
          });
        } else {
          // Calculate amount based on multiplier
          let amount = Math.round(baseReward.amount * cycle.multiplier);
          
          // Special handling for fate coins in cycle 3 and 4
          if (baseReward.reward_type === 'fate_coins' && cycle.multiplier >= 2.0) {
            amount = Math.round(baseReward.amount * cycle.multiplier);
          }
          
          // Special handling for packs in cycle 3 and 4
          if (baseReward.reward_type === 'card_pack' && cycle.multiplier >= 2.0) {
            amount = Math.round(baseReward.amount * cycle.multiplier);
          }
          
          rewards.push({
            day,
            reward_type: baseReward.reward_type,
            amount,
            card_id: null,
          });
        }
      }
    }

    // Insert or update reward configurations
    for (const reward of rewards) {
      const query = `
        INSERT INTO monthly_login_config (day, reward_type, amount, card_id, is_active)
        VALUES ($1, $2, $3, $4, true)
        ON CONFLICT (day) DO UPDATE SET
          reward_type = EXCLUDED.reward_type,
          amount = EXCLUDED.amount,
          card_id = EXCLUDED.card_id,
          is_active = EXCLUDED.is_active,
          updated_at = current_timestamp;
      `;
      
      await db.query(query, [
        reward.day,
        reward.reward_type,
        reward.amount,
        reward.card_id
      ]);
      
      const rewardDesc = reward.reward_type === 'enhanced_card' 
        ? '1 random enhanced card'
        : `${reward.amount} ${reward.reward_type}`;
      console.log(`✅ Day ${reward.day}: ${rewardDesc}`);
    }

    console.log("🎉 Monthly login reward configuration setup complete!");
    console.log(`📊 Configured ${rewards.length} days of rewards`);
    
  } catch (error) {
    console.error("❌ Error setting up monthly login configuration:", error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  setupMonthlyLoginConfig()
    .then(() => {
      console.log("Setup completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      console.error("Setup failed:", error);
      process.exit(1);
    });
}

module.exports = { setupMonthlyLoginConfig };

