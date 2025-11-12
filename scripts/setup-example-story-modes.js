/**
 * Example script to set up some basic story modes
 * This demonstrates how to configure story modes with different difficulties and rewards
 */

require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const AI_PLAYER_ID = "00000000-0000-0000-0000-000000000000";

// Example story mode configurations
const EXAMPLE_STORY_MODES = [
  {
    name: "Training Grounds",
    description: "A gentle introduction to combat. Perfect for new warriors learning the basics.",
    difficulty: "easy",
    order_index: 0,
    unlock_requirements: {}, // Available from start
    rewards: [
      {
        reward_type: "first_win",
        reward_data: {
          gold: 100,
          gems: 5,
          card_xp: 50
        }
      },
      {
        reward_type: "repeat_win", 
        reward_data: {
          gold: 25,
          card_xp: 15
        }
      }
    ]
  },
  {
    name: "Forest Guardian",
    description: "An ancient protector of the woods challenges you to prove your worth.",
    difficulty: "medium",
    order_index: 1,
    unlock_requirements: {
      min_user_level: 3
    },
    rewards: [
      {
        reward_type: "first_win",
        reward_data: {
          gold: 150,
          gems: 10,
          card_xp: 75
        }
      },
      {
        reward_type: "repeat_win",
        reward_data: {
          gold: 35,
          card_xp: 20
        }
      }
    ]
  },
  {
    name: "Mountain King",
    description: "The ruler of the peaks tests your strategic mastery in brutal combat.",
    difficulty: "hard",
    order_index: 2,
    unlock_requirements: {
      min_user_level: 8,
      min_total_story_wins: 5
    },
    rewards: [
      {
        reward_type: "first_win",
        reward_data: {
          gold: 200,
          gems: 15,
          card_xp: 100
        }
      },
      {
        reward_type: "repeat_win",
        reward_data: {
          gold: 50,
          card_xp: 30
        }
      }
    ]
  },
  {
    name: "Shadow Lord",
    description: "The ultimate challenge. Only the most skilled warriors dare face this legendary foe.",
    difficulty: "legendary",
    order_index: 3,
    unlock_requirements: {
      min_user_level: 15,
      min_total_story_wins: 15
    },
    rewards: [
      {
        reward_type: "first_win",
        reward_data: {
          gold: 300,
          gems: 25,
          card_xp: 150,
          fate_coins: 1
        }
      },
      {
        reward_type: "repeat_win",
        reward_data: {
          gold: 75,
          card_xp: 40
        }
      }
    ]
  }
];

async function setupExampleStoryModes() {
  const client = await pool.connect();
  
  try {
    console.log("🎮 Setting up example story modes...");
    
    // First, get available AI decks
    const aiDecksResult = await client.query(
      'SELECT deck_id, name FROM decks WHERE user_id = $1 ORDER BY name',
      [AI_PLAYER_ID]
    );
    
    if (aiDecksResult.rows.length === 0) {
      console.error("❌ No AI decks found! Please run the create-ai-decks script first.");
      return;
    }
    
    console.log(`📦 Found ${aiDecksResult.rows.length} AI decks:`);
    aiDecksResult.rows.forEach((deck, index) => {
      console.log(`  ${index + 1}. ${deck.name} (${deck.deck_id})`);
    });
    
    await client.query('BEGIN');
    
    let createdCount = 0;
    
    for (let i = 0; i < EXAMPLE_STORY_MODES.length; i++) {
      const storyConfig = EXAMPLE_STORY_MODES[i];
      
      // Use AI decks in order, cycling if we have more story modes than decks
      const aiDeck = aiDecksResult.rows[i % aiDecksResult.rows.length];
      
      console.log(`\n📖 Creating story mode: "${storyConfig.name}"`);
      console.log(`   Using AI deck: ${aiDeck.name}`);
      console.log(`   Difficulty: ${storyConfig.difficulty}`);
      
      // Check if story mode already exists
      const existingResult = await client.query(
        'SELECT story_id FROM story_mode_config WHERE name = $1',
        [storyConfig.name]
      );
      
      if (existingResult.rows.length > 0) {
        console.log(`   ⚠️  Story mode "${storyConfig.name}" already exists, skipping...`);
        continue;
      }
      
      // Create the story mode configuration
      const storyResult = await client.query(`
        INSERT INTO story_mode_config (
          name, description, difficulty, ai_deck_id, order_index, unlock_requirements
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING story_id
      `, [
        storyConfig.name,
        storyConfig.description,
        storyConfig.difficulty,
        aiDeck.deck_id,
        storyConfig.order_index,
        JSON.stringify(storyConfig.unlock_requirements)
      ]);
      
      const storyId = storyResult.rows[0].story_id;
      
      // Create rewards
      for (const reward of storyConfig.rewards) {
        await client.query(`
          INSERT INTO story_mode_rewards (
            story_id, reward_type, reward_data
          ) VALUES ($1, $2, $3)
        `, [
          storyId,
          reward.reward_type,
          JSON.stringify(reward.reward_data)
        ]);
      }
      
      console.log(`   ✅ Created with ${storyConfig.rewards.length} reward configurations`);
      createdCount++;
    }
    
    await client.query('COMMIT');
    
    console.log(`\n🎉 Successfully created ${createdCount} story modes!`);
    
    if (createdCount > 0) {
      console.log("\n📋 Story Mode Summary:");
      const summaryResult = await client.query(`
        SELECT name, difficulty, order_index, ai_deck_id,
               (SELECT name FROM decks WHERE deck_id = smc.ai_deck_id) as ai_deck_name
        FROM story_mode_config smc 
        WHERE is_active = true 
        ORDER BY order_index
      `);
      
      summaryResult.rows.forEach((story, index) => {
        console.log(`  ${index + 1}. ${story.name} (${story.difficulty})`);
        console.log(`     AI Deck: ${story.ai_deck_name}`);
      });
    }
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("❌ Error setting up story modes:", error);
  } finally {
    client.release();
    pool.end();
  }
}

// Run the setup if this file is executed directly
if (require.main === module) {
  setupExampleStoryModes().catch(console.error);
}

module.exports = { setupExampleStoryModes };
