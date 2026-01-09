/**
 * Script to setup initial tower floors (1-5) from scratch
 * This script creates the first floors using existing AI decks from the database
 */

// Load environment variables from .env file
require("dotenv").config();

const { Pool } = require("pg");

// Create database connection using environment variables
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_URL?.includes("render.com") ||
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

const AI_PLAYER_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Calculate target average card level for a given floor using gradual scaling
 */
function calculateTargetAverageLevel(floorNumber) {
  let baseLevel = 1.0;
  
  if (floorNumber <= 1) {
    return 1.0;
  } else if (floorNumber <= 50) {
    return baseLevel + (floorNumber - 1) * 0.02;
  } else if (floorNumber <= 100) {
    const previousLevel = 2.0;
    return previousLevel + (floorNumber - 50) * 0.03;
  } else if (floorNumber <= 200) {
    const previousLevel = 3.5;
    return previousLevel + (floorNumber - 100) * 0.03;
  } else {
    const previousLevel = 6.5;
    return previousLevel + (floorNumber - 200) * 0.04;
  }
}

async function setupInitialFloors() {
  try {
    console.log("\n=== Setting Up Initial Tower Floors ===\n");
    console.log(`Database: ${process.env.DATABASE_URL?.split("@")[1] || "local"}`);

    // Check if floors already exist
    const existingFloors = await pool.query(
      "SELECT floor_number FROM tower_floors ORDER BY floor_number"
    );

    if (existingFloors.rows.length > 0) {
      console.log(`\n⚠️  Tower already has ${existingFloors.rows.length} floors:`);
      console.log(existingFloors.rows.map(r => `Floor ${r.floor_number}`).join(", "));
      console.log("\nIf you want to reset, run: node scripts/reset-tower-with-new-scaling.js\n");
      await pool.end();
      process.exit(0);
    }

    // Get all AI decks
    const aiDecks = await pool.query(
      `SELECT deck_id, name FROM decks WHERE user_id = $1 ORDER BY created_at LIMIT 5`,
      [AI_PLAYER_ID]
    );

    if (aiDecks.rows.length < 2) {
      console.error("❌ Not enough AI decks found. Need at least 2 AI decks in the database.");
      console.log("\nTo create AI decks, run: node scripts/create-ai-decks.js");
      await pool.end();
      process.exit(1);
    }

    console.log(`\nFound ${aiDecks.rows.length} AI decks to use\n`);

    // Create tower floors using existing AI decks
    const floorsToCreate = Math.min(5, aiDecks.rows.length);
    
    for (let i = 0; i < floorsToCreate; i++) {
      const floorNumber = i + 1;
      const deck = aiDecks.rows[i];
      const targetLevel = calculateTargetAverageLevel(floorNumber);

      // Calculate actual average level of the deck
      const avgLevelResult = await pool.query(
        `SELECT ROUND(AVG(uoc.level)::numeric, 1) as avg_level
         FROM deck_cards dc
         JOIN user_owned_cards uoc ON dc.user_card_instance_id = uoc.user_card_instance_id
         WHERE dc.deck_id = $1`,
        [deck.deck_id]
      );

      const actualAvgLevel = avgLevelResult.rows[0]?.avg_level || 1.0;

      await pool.query(
        `INSERT INTO tower_floors (floor_number, name, ai_deck_id, average_card_level, is_active, created_at)
         VALUES ($1, $2, $3, $4, true, NOW())`,
        [floorNumber, `Floor ${floorNumber}`, deck.deck_id, actualAvgLevel]
      );

      console.log(`✓ Created Floor ${floorNumber}`);
      console.log(`  Name: Floor ${floorNumber}`);
      console.log(`  Deck: ${deck.name}`);
      console.log(`  Target Level: ${targetLevel.toFixed(2)}`);
      console.log(`  Actual Level: ${actualAvgLevel}`);
      console.log();
    }

    console.log(`✅ Successfully created ${floorsToCreate} initial tower floors!\n`);
    console.log("Next steps:");
    console.log("1. Check the tower: node scripts/recalculate-tower-levels.js");
    console.log("2. When users beat the last floor, more will generate automatically");
    console.log("3. Or manually generate more: node scripts/trigger-tower-generation.js 6 5 5\n");

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Error setting up tower floors:", error);
    await pool.end();
    process.exit(1);
  }
}

setupInitialFloors();


