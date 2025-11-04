require("dotenv").config();
const { Pool } = require("pg");

// DB connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const AI_PLAYER_ID = "00000000-0000-0000-0000-000000000000";
const AI_USERNAME = "AI Opponent";
const AI_EMAIL = "ai@mythgame.com";

async function createAIUser() {
  const client = await pool.connect();

  try {
    // Check if AI user already exists
    const checkQuery = `SELECT * FROM "users" WHERE user_id = $1`;
    const { rows } = await client.query(checkQuery, [AI_PLAYER_ID]);

    if (rows.length > 0) {
      console.log("AI user already exists");
      return;
    }

    // Create AI user with predefined UUID
    const createQuery = `
      INSERT INTO "users" (user_id, username, email, password_hash, in_game_currency, gold, gems, fate_coins, total_xp, pack_count, created_at, last_login)
      VALUES ($1, $2, $3, $4, 0, 0, 0, 2, 0, 10, NOW(), NOW())
    `;

    // No need for a real password since AI won't log in
    const passwordHash = "not_a_real_password";

    await client.query(createQuery, [
      AI_PLAYER_ID,
      AI_USERNAME,
      AI_EMAIL,
      passwordHash,
    ]);
    console.log("AI user created successfully");
  } catch (error) {
    console.error("Error creating AI user:", error);
  } finally {
    client.release();
    pool.end();
  }
}

createAIUser();
