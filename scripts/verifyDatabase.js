// scripts/verifyDatabase.js
require("dotenv").config();
const { Pool } = require("pg");

// Create a connection pool using the DATABASE_URL from .env
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function verifyDatabase() {
  console.log("Connecting to database to verify contents...");
  const client = await pool.connect();

  try {
    // Check special abilities
    const abilities = await client.query(
      "SELECT COUNT(*) as count FROM special_abilities"
    );
    console.log(`Special abilities count: ${abilities.rows[0].count}`);

    // Get some sample abilities
    const sampleAbilities = await client.query(
      "SELECT id, name, trigger_moment FROM special_abilities LIMIT 3"
    );
    console.log("Sample abilities:");
    sampleAbilities.rows.forEach((ability) => {
      console.log(
        `- ${ability.name} (${ability.id}): ${ability.trigger_moment}`
      );
    });

    // Check cards
    const cards = await client.query("SELECT COUNT(*) as count FROM cards");
    console.log(`\nCards count: ${cards.rows[0].count}`);

    // Get some sample cards
    const sampleCards = await client.query(
      "SELECT name, type, rarity FROM cards LIMIT 3"
    );
    console.log("Sample cards:");
    sampleCards.rows.forEach((card) => {
      console.log(`- ${card.name} (${card.type}): ${card.rarity}`);
    });

    // Check cards with abilities
    const cardsWithAbilities = await client.query(`
      SELECT c.name as card_name, sa.name as ability_name 
      FROM cards c
      JOIN special_abilities sa ON c.special_ability_id = sa.ability_id
      LIMIT 3
    `);
    console.log("\nSample cards with abilities:");
    cardsWithAbilities.rows.forEach((row) => {
      console.log(`- ${row.card_name} has ability: ${row.ability_name}`);
    });
  } catch (err) {
    console.error("Error verifying database:", err);
  } finally {
    client.release();
    await pool.end();
    console.log("\nDatabase connection closed.");
  }
}

verifyDatabase().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
