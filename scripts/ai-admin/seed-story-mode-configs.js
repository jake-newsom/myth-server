require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const AI_PLAYER_ID = process.env.AI_USER_ID || "00000000-0000-0000-0000-000000000000";

// Chapter definitions matching seed-ai-story-decks.js
const CHAPTERS = [
  { chapter: 1, name: "Forest Whispers", description: "Japanese Intro", boss: "Hachiman" },
  { chapter: 2, name: "Sun over Steel", description: "Japanese mastery", boss: "Susanoo" },
  { chapter: 3, name: "Winter of Ravens", description: "Norse intro", boss: "Vidar" },
  { chapter: 4, name: "Hammerfall", description: "Norse mastery", boss: "Thor" },
  { chapter: 5, name: "Tides of Creation", description: "Polynesian intro", boss: "Pele" },
  { chapter: 6, name: "Heart of Fire", description: "Polynesian mastery", boss: "Kāne" },
  { chapter: 7, name: "Clash of Currents", description: "JP × Poly hybrid", boss: "Ryūjin" },
  { chapter: 8, name: "Twilight Council", description: "Norse × Japanese hybrid", boss: "Odin" },
  { chapter: 9, name: "When Worlds Collide", description: "Triple-culture", boss: "Loki" },
  { chapter: 10, name: "The Convergence", description: "Boss prelude", boss: "Odin & Pele" }
];

// Reward structure by difficulty level
const REWARDS_BY_LEVEL = {
  1: {
    first_win: { gold: 100, gems: 5, card_xp: 50 },
    repeat_win: { gold: 25, card_xp: 15 }
  },
  2: {
    first_win: { gold: 150, gems: 8, card_xp: 75 },
    repeat_win: { gold: 35, card_xp: 20 }
  },
  3: {
    first_win: { gold: 200, gems: 12, card_xp: 100 },
    repeat_win: { gold: 50, card_xp: 30 }
  },
  4: {
    first_win: { gold: 250, gems: 18, card_xp: 125 },
    repeat_win: { gold: 60, card_xp: 35 }
  },
  5: {
    first_win: { gold: 300, gems: 25, card_xp: 150, fate_coins: 1 },
    repeat_win: { gold: 75, card_xp: 40 }
  }
};

/**
 * Find AI deck by chapter and level
 */
async function findDeck(client, chapter, level) {
  const deckName = `AI Story ${chapter} - ${CHAPTERS[chapter - 1].name} (L${level})`;
  const result = await client.query(
    `SELECT deck_id FROM decks WHERE user_id = $1 AND name = $2`,
    [AI_PLAYER_ID, deckName]
  );
  
  if (result.rows.length === 0) {
    throw new Error(`Deck not found: ${deckName}. Please run seed-ai-story-decks.js first.`);
  }
  
  return result.rows[0].deck_id;
}

/**
 * Create a story mode config entry
 */
async function createStoryModeConfig(client, config) {
  const { chapter, level, deckId, orderIndex, unlockRequirements, storyId } = config;
  const chapterInfo = CHAPTERS[chapter - 1];
  const name = `${chapterInfo.name} - Level ${level}`;
  const description = `${chapterInfo.description} (Difficulty ${level}/5)`;
  
  // Check if already exists
  const existing = await client.query(
    `SELECT story_id FROM story_mode_config WHERE story_id = $1`,
    [storyId]
  );
  
  if (existing.rows.length > 0) {
    // Update existing
    await client.query(`
      UPDATE story_mode_config
      SET 
        name = $1,
        description = $2,
        difficulty = $3,
        ai_deck_id = $4,
        order_index = $5,
        unlock_requirements = $6,
        is_active = true,
        updated_at = NOW()
      WHERE story_id = $7
    `, [name, description, level, deckId, orderIndex, JSON.stringify(unlockRequirements), storyId]);
    
    // Delete existing rewards
    await client.query(`DELETE FROM story_mode_rewards WHERE story_id = $1`, [storyId]);
  } else {
    // Create new
    await client.query(`
      INSERT INTO story_mode_config (
        story_id, name, description, difficulty, ai_deck_id, order_index, 
        unlock_requirements, is_active, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW(), NOW())
    `, [storyId, name, description, level, deckId, orderIndex, JSON.stringify(unlockRequirements)]);
  }
  
  // Add rewards
  const rewards = REWARDS_BY_LEVEL[level];
  for (const [rewardType, rewardData] of Object.entries(rewards)) {
    await client.query(`
      INSERT INTO story_mode_rewards (story_id, reward_type, reward_data, is_active, created_at)
      VALUES ($1, $2, $3, true, NOW())
    `, [storyId, rewardType, JSON.stringify(rewardData)]);
  }
  
  return storyId;
}

/**
 * Generate UUID v4 (simple implementation)
 */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Main seeding function
 */
async function seedStoryModeConfigs() {
  const client = await pool.connect();
  
  try {
    console.log("🚀 Starting Story Mode Config Seeding...");
    console.log(`AI User ID: ${AI_PLAYER_ID}`);
    
    // Verify AI user exists
    const userCheck = await client.query(
      `SELECT user_id FROM users WHERE user_id = $1`,
      [AI_PLAYER_ID]
    );
    
    if (userCheck.rows.length === 0) {
      throw new Error(`AI user with ID ${AI_PLAYER_ID} not found. Please create the AI user first.`);
    }
    
    await client.query('BEGIN');
    
    // Generate all story IDs upfront for unlock chain building
    const storyIds = {};
    for (let chapter = 1; chapter <= 10; chapter++) {
      storyIds[chapter] = {};
      for (let level = 1; level <= 5; level++) {
        storyIds[chapter][level] = generateUUID();
      }
    }
    
    const createdConfigs = [];
    
    // Create all 50 story mode configs
    for (let chapter = 1; chapter <= 10; chapter++) {
      console.log(`\n📖 Chapter ${chapter}: ${CHAPTERS[chapter - 1].name}`);
      
      for (let level = 1; level <= 5; level++) {
        const orderIndex = (chapter - 1) * 5 + (level - 1);
        const deckId = await findDeck(client, chapter, level);
        const storyId = storyIds[chapter][level];
        
        // Build unlock requirements
        let unlockRequirements = {};
        
        if (chapter === 1 && level === 1) {
          // First entry - no requirements
          unlockRequirements = {};
        } else if (level === 1) {
          // First difficulty of a new chapter - require previous chapter's last difficulty
          const previousChapter = chapter - 1;
          const previousStoryId = storyIds[previousChapter][5];
          unlockRequirements = {
            prerequisite_stories: [previousStoryId]
          };
        } else {
          // Higher difficulty - require previous difficulty in same chapter
          const previousLevel = level - 1;
          const previousStoryId = storyIds[chapter][previousLevel];
          unlockRequirements = {
            prerequisite_stories: [previousStoryId]
          };
        }
        
        await createStoryModeConfig(client, {
          chapter,
          level,
          deckId,
          orderIndex,
          unlockRequirements,
          storyId
        });
        
        createdConfigs.push({
          chapter,
          level,
          storyId,
          name: `${CHAPTERS[chapter - 1].name} - Level ${level}`
        });
        
        console.log(`  ✅ Level ${level}: ${storyId.substring(0, 8)}...`);
      }
    }
    
    await client.query('COMMIT');
    
    // Summary
    console.log("\n📊 Summary:");
    console.log(`   Total Story Modes Created: ${createdConfigs.length}`);
    console.log(`   Chapters: ${CHAPTERS.length}`);
    console.log(`   Difficulties per Chapter: 5`);
    console.log(`   Total Entries: ${createdConfigs.length}`);
    
    console.log("\n🔗 Unlock Chain Structure:");
    console.log("   Chapter 1, Level 1: Starter (no requirements)");
    for (let chapter = 1; chapter <= 10; chapter++) {
      if (chapter === 1) {
        console.log(`   Chapter ${chapter}: Level 1 → Level 2 → Level 3 → Level 4 → Level 5`);
      } else {
        console.log(`   Chapter ${chapter}: Level 1 (requires Ch${chapter - 1} L5) → Level 2 → Level 3 → Level 4 → Level 5`);
      }
    }
    
    console.log("\n✅ Story mode config seeding completed successfully!");
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("\n❌ Error:", error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run if executed directly
if (require.main === module) {
  seedStoryModeConfigs().catch(error => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

module.exports = { seedStoryModeConfigs };

