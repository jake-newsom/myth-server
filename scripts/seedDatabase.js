// scripts/seedDatabase.js
require("dotenv").config(); // Load environment variables
const { Pool } = require("pg");
const { CARDS_DATA, SPECIAL_ABILITIES_DATA } = require("./game-data");

// Create a connection pool using the DATABASE_URL from .env
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * Seeds special abilities into the database
 * @param {Object} client - Database client
 */
async function seedSpecialAbilities(client) {
  console.log("Seeding special abilities...");

  for (const ability of SPECIAL_ABILITIES_DATA) {
    try {
      // Check if ability already exists to avoid duplicates
      const existingAbility = await client.query(
        "SELECT ability_id FROM special_abilities WHERE id = $1",
        [ability.id]
      );

      if (existingAbility.rows.length > 0) {
        console.log(`Ability "${ability.name}" already exists, skipping.`);
        continue;
      }

      // Insert the new ability
      const result = await client.query(
        `INSERT INTO special_abilities 
         (id, name, description, trigger_moment, parameters) 
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ability_id`,
        [
          ability.id,
          ability.name,
          ability.description,
          ability.triggerMoment,
          JSON.stringify(ability.parameters),
        ]
      );

      console.log(
        `Seeded ability: ${ability.name} (${result.rows[0].ability_id})`
      );
    } catch (err) {
      console.error(`Error seeding ability ${ability.name}:`, err.message);
    }
  }

  console.log("Finished seeding special abilities.");
}

/**
 * Seeds cards into the database
 * @param {Object} client - Database client
 */
async function seedCards(client) {
  console.log("Seeding cards...");

  // First get the ability IDs to reference in cards
  const abilityIdMap = new Map();

  try {
    const abilities = await client.query(
      "SELECT ability_id, id FROM special_abilities"
    );

    abilities.rows.forEach((ability) => {
      abilityIdMap.set(ability.id, ability.ability_id);
    });
  } catch (err) {
    console.error("Error fetching ability IDs:", err.message);
    return;
  }

  for (const card of CARDS_DATA) {
    try {
      // Check if card already exists to avoid duplicates
      const existingCard = await client.query(
        "SELECT card_id FROM cards WHERE name = $1",
        [card.name]
      );

      if (existingCard.rows.length > 0) {
        console.log(`Card "${card.name}" already exists, skipping.`);
        continue;
      }

      // Look up the special ability ID
      let specialAbilityId = null;
      if (card.specialAbilityId) {
        specialAbilityId = abilityIdMap.get(card.specialAbilityId);
        if (!specialAbilityId) {
          console.warn(
            `Warning: Special ability "${card.specialAbilityId}" not found for card "${card.name}"`
          );
        }
      }

      // Insert the new card
      const result = await client.query(
        `INSERT INTO cards 
         (name, type, rarity, image_url, power, special_ability_id, tags) 
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING card_id`,
        [
          card.name,
          card.type,
          card.rarity,
          card.imageUrl,
          JSON.stringify(card.power),
          specialAbilityId,
          card.tags,
        ]
      );

      console.log(`Seeded card: ${card.name} (${result.rows[0].card_id})`);
    } catch (err) {
      console.error(`Error seeding card ${card.name}:`, err.message);
    }
  }

  console.log("Finished seeding cards.");
}

/**
 * Main function to run the seeding process
 */
async function main() {
  console.log("Connecting to database for seeding...");
  const client = await pool.connect();

  try {
    console.log("Starting database seeding...");
    await client.query("BEGIN"); // Start transaction

    // Seed data in the correct order (special abilities first)
    await seedSpecialAbilities(client);
    await seedCards(client);

    await client.query("COMMIT"); // Commit transaction
    console.log("Database seeding completed successfully.");
  } catch (err) {
    await client.query("ROLLBACK"); // Rollback transaction on error
    console.error("Seeding failed. Transaction rolled back:", err);
  } finally {
    client.release(); // Release client back to pool
    await pool.end(); // Close pool
    console.log("Database connection closed.");
  }
}

// Run the seeding process
main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
