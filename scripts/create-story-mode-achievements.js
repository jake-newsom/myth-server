// Load environment variables from .env file
require('dotenv').config();

const db = require("../dist/config/db.config.js").default;

/**
 * Create story mode achievements for all existing stories
 * Each story gets 5 achievements:
 * - Win once (tier 1 of wins)
 * - Win 10 times (tier 2 of wins)
 * - Win by 4 cards (tier 1 of victory margin)
 * - Win by 6 cards (tier 2 of victory margin)
 * - Win by 8 cards (tier 3 of victory margin)
 */
async function createStoryModeAchievements() {
  try {
    console.log("🏆 Creating story mode achievements for all stories...");

    // Get all active story modes
    const storiesResult = await db.query(`
      SELECT story_id, name FROM story_mode_config 
      WHERE is_active = true 
      ORDER BY order_index ASC
    `);

    if (storiesResult.rows.length === 0) {
      console.log("⚠️  No active story modes found. Skipping achievement creation.");
      return;
    }

    console.log(`📚 Found ${storiesResult.rows.length} active story modes`);

    for (const story of storiesResult.rows) {
      const storyId = story.story_id;
      const storyName = story.name;

      console.log(`\n📖 Processing story: ${storyName} (${storyId})`);

      // Check if achievements already exist for this story
      const existingCheck = await db.query(`
        SELECT COUNT(*) as count FROM achievements 
        WHERE story_id = $1
      `, [storyId]);

      if (parseInt(existingCheck.rows[0].count) > 0) {
        console.log(`  ⏭️  Achievements already exist for this story, skipping...`);
        continue;
      }

      // Insert win count achievements (2 tiers: 1 win, 10 wins)
      const winsBaseKey = `story_${storyId}_wins`;
      
      await db.query(`
        INSERT INTO achievements (
          achievement_key, title, description, category, type, target_value,
          rarity, reward_gold, reward_gems, reward_packs, base_achievement_key, tier_level, story_id, sort_order
        ) VALUES
        ($1, $2, $3, 'story_mode', 'progress', 1, 'common', 50, 2, 0, $4, 1, $5, 1),
        ($6, $7, $8, 'story_mode', 'progress', 10, 'uncommon', 200, 10, 0, $4, 2, $5, 2)
      `, [
        `${winsBaseKey}_1`, `Win Once`, `Win ${storyName} once`, winsBaseKey, storyId,
        `${winsBaseKey}_10`, `Win 10 Times`, `Win ${storyName} 10 times`
      ]);

      console.log(`  ✅ Created win count achievements (1 win, 10 wins)`);

      // Insert victory margin achievements (3 tiers: win by 4, 6, 8)
      const marginBaseKey = `story_${storyId}_victory_margin`;
      
      await db.query(`
        INSERT INTO achievements (
          achievement_key, title, description, category, type, target_value,
          rarity, reward_gold, reward_gems, reward_packs, base_achievement_key, tier_level, story_id, sort_order
        ) VALUES
        ($1, $2, $3, 'story_mode', 'single', 4, 'common', 100, 5, 0, $4, 1, $5, 3),
        ($6, $7, $8, 'story_mode', 'single', 6, 'uncommon', 150, 8, 0, $4, 2, $5, 4),
        ($9, $10, $11, 'story_mode', 'single', 8, 'rare', 250, 15, 0, $4, 3, $5, 5)
      `, [
        `${marginBaseKey}_4`, `Win by 4`, `Win ${storyName} by 4 or more cards`, marginBaseKey, storyId,
        `${marginBaseKey}_6`, `Win by 6`, `Win ${storyName} by 6 or more cards`,
        `${marginBaseKey}_8`, `Win by 8`, `Win ${storyName} by 8 or more cards`
      ]);

      console.log(`  ✅ Created victory margin achievements (win by 4, 6, 8)`);
    }

    console.log("\n🎉 Story mode achievements creation complete!");
    
  } catch (error) {
    console.error("❌ Error creating story mode achievements:", error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  createStoryModeAchievements()
    .then(() => {
      console.log("✅ Script completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Script failed:", error);
      process.exit(1);
    });
}

module.exports = { createStoryModeAchievements };

