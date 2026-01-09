/**
 * Script to bootstrap the tower from scratch by generating the first floors
 * This creates floors 1-5 using AI generation with proper level scaling
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
 * Calculate target average card level for a given floor
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

/**
 * Create a simple deck manually for floor 1
 */
async function createFloor1Deck() {
  const client = await pool.connect();
  
  try {
    await client.query("BEGIN");

    // Create deck
    const deckResult = await client.query(
      `INSERT INTO decks (user_id, name, created_at, last_updated)
       VALUES ($1, $2, NOW(), NOW())
       RETURNING deck_id`,
      [AI_PLAYER_ID, "Floor 1 - The Beginning"]
    );
    const deckId = deckResult.rows[0].deck_id;

    // Get a variety of cards at level 1
    const cardsResult = await client.query(`
      SELECT card_id, name, rarity 
      FROM cards 
      WHERE rarity::text NOT LIKE '%+'
      ORDER BY 
        CASE 
          WHEN rarity = 'common' THEN 1
          WHEN rarity = 'uncommon' THEN 2
          WHEN rarity = 'rare' THEN 3
          WHEN rarity = 'epic' THEN 4
          WHEN rarity = 'legendary' THEN 5
        END,
        RANDOM()
      LIMIT 30
    `);

    if (cardsResult.rows.length < 20) {
      throw new Error("Not enough cards in database to create deck");
    }

    // Select 20 cards: mix of rarities, all at level 1
    const selectedCards = [];
    const cardsByRarity = {
      common: cardsResult.rows.filter(c => c.rarity === 'common'),
      uncommon: cardsResult.rows.filter(c => c.rarity === 'uncommon'),
      rare: cardsResult.rows.filter(c => c.rarity === 'rare'),
      epic: cardsResult.rows.filter(c => c.rarity === 'epic'),
      legendary: cardsResult.rows.filter(c => c.rarity === 'legendary'),
    };

    // Add cards: 8 common, 6 uncommon, 4 rare, 2 epic
    selectedCards.push(...cardsByRarity.common.slice(0, 8));
    selectedCards.push(...cardsByRarity.uncommon.slice(0, 6));
    selectedCards.push(...cardsByRarity.rare.slice(0, 4));
    selectedCards.push(...cardsByRarity.epic.slice(0, 2));

    // Create card instances at level 1 and add to deck
    let cardsAdded = 0;
    for (const card of selectedCards) {
      // Create card instance
      const instanceResult = await client.query(
        `INSERT INTO user_owned_cards (user_id, card_id, level, xp, created_at)
         VALUES ($1, $2, 1, 0, NOW())
         RETURNING user_card_instance_id`,
        [AI_PLAYER_ID, card.card_id]
      );
      const instanceId = instanceResult.rows[0].user_card_instance_id;

      // Add to deck
      await client.query(
        `INSERT INTO deck_cards (deck_id, user_card_instance_id)
         VALUES ($1, $2)`,
        [deckId, instanceId]
      );
      cardsAdded++;
    }

    // Create tower floor
    await client.query(
      `INSERT INTO tower_floors (floor_number, name, ai_deck_id, average_card_level, is_active, created_at)
       VALUES ($1, $2, $3, $4, true, NOW())`,
      [1, "The Beginning", deckId, 1.0]
    );

    await client.query("COMMIT");
    
    console.log("✓ Created Floor 1");
    console.log(`  Name: The Beginning`);
    console.log(`  Cards: ${cardsAdded} (all level 1)`);
    console.log(`  Average Level: 1.0`);
    console.log();

    return deckId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function bootstrapTower() {
  try {
    console.log("\n=== Bootstrapping Tower from Scratch ===\n");
    console.log(`Database: ${process.env.DATABASE_URL?.split("@")[1] || "local"}`);

    // Check if floors already exist
    const existingFloors = await pool.query(
      "SELECT floor_number FROM tower_floors ORDER BY floor_number"
    );

    if (existingFloors.rows.length > 0) {
      console.log(`\n⚠️  Tower already has ${existingFloors.rows.length} floors.`);
      console.log("\nTo reset and start fresh, run:");
      console.log("  node scripts/reset-tower-with-new-scaling.js");
      console.log("\nThen run this script again.\n");
      await pool.end();
      process.exit(0);
    }

    // Step 1: Create floor 1 manually with level 1 cards
    console.log("Step 1: Creating Floor 1 with level 1 cards...\n");
    await createFloor1Deck();

    // Step 2: Generate floors 2-5 using the generation service
    console.log("Step 2: Generating Floors 2-5 using AI generation...\n");
    
    const TowerGenerationService = require("../dist/services/towerGeneration.service").default;
    
    await TowerGenerationService.triggerGeneration(2, 4, 1);

    console.log("\n✅ Tower bootstrap complete!\n");
    console.log("Created floors 1-5 with proper level scaling.");
    console.log("\nNext steps:");
    console.log("1. Check the tower: node scripts/recalculate-tower-levels.js");
    console.log("2. When users progress, more floors will generate automatically\n");

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Error bootstrapping tower:", error);
    await pool.end();
    process.exit(1);
  }
}

bootstrapTower();


