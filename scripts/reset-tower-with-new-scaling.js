/**
 * Script to reset the tower and regenerate floors with proper scaling
 * Use this after updating the difficulty scaling formula
 */

const db = require("../dist/config/db.config").default;
const TowerGenerationService = require("../dist/services/towerGeneration.service").default;

async function resetAndRegenerateTower() {
  console.log("\n=== Resetting Tower with New Scaling ===\n");

  const client = await db.getClient();

  try {
    await client.query("BEGIN");

    // Get all tower floors
    const floorsResult = await client.query(`
      SELECT floor_number, ai_deck_id 
      FROM tower_floors 
      ORDER BY floor_number ASC
    `);

    console.log(`Found ${floorsResult.rows.length} existing floors to clean up`);

    // Delete tower floors and their associated decks
    for (const floor of floorsResult.rows) {
      console.log(`Cleaning up floor ${floor.floor_number}...`);
      
      // Delete deck cards
      await client.query(
        "DELETE FROM deck_cards WHERE deck_id = $1",
        [floor.ai_deck_id]
      );
      
      // Delete user owned cards for this deck
      await client.query(`
        DELETE FROM user_owned_cards 
        WHERE user_id = '00000000-0000-0000-0000-000000000000'
        AND user_card_instance_id IN (
          SELECT user_card_instance_id 
          FROM deck_cards 
          WHERE deck_id = $1
        )
      `, [floor.ai_deck_id]);
      
      // Delete the deck
      await client.query(
        "DELETE FROM decks WHERE deck_id = $1",
        [floor.ai_deck_id]
      );
    }

    // Delete all tower floors
    await client.query("DELETE FROM tower_floors");

    // Reset all users to floor 1
    await client.query("UPDATE users SET tower_floor = 1");

    await client.query("COMMIT");
    console.log("✓ Tower reset complete");

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error during reset:", error);
    process.exit(1);
  } finally {
    client.release();
  }

  // Now generate the first batch of floors with new scaling
  console.log("\n=== Generating Initial Floors ===\n");
  
  try {
    // Use the bootstrap script to create floors 1-5 properly
    const { execSync } = require('child_process');
    execSync('node scripts/bootstrap-tower.js', { stdio: 'inherit' });
    
  } catch (error) {
    console.error("Error generating floors:", error);
    process.exit(1);
  }

  process.exit(0);
}

resetAndRegenerateTower();

