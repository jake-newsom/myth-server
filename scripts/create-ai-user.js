/**
 * Creates the AI sentinel user (00000000-0000-0000-0000-000000000000).
 *
 * Every solo/tower/tutorial game inserts this UUID as games.player2_id, so a
 * database without this row fails every such insert on games_player2_id_fkey.
 * Run this once against any freshly provisioned database.
 *
 * Usage (dev — targets DATABASE_URL):
 *   node scripts/create-ai-user.js
 *
 * Usage (production — targets DATABASE_URL_PROD):
 *   node scripts/create-ai-user.js --prod
 *
 * Idempotent: re-running against a database that already has the row is a no-op.
 */
require("dotenv").config();
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

const AI_PLAYER_ID = "00000000-0000-0000-0000-000000000000";
const AI_USERNAME = "AI Opponent";
const AI_EMAIL = "ai@mythgame.com";

function unquote(value) {
  return value.replace(/^["']|["']$/g, "");
}

function readEnvFileKey(key) {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return null;
  const pattern = new RegExp(`^\\s*${key}\\s*=`);
  const line = fs
    .readFileSync(envPath, "utf8")
    .split("\n")
    .find((l) => pattern.test(l));
  if (!line) return null;
  return unquote(line.slice(line.indexOf("=") + 1).trim());
}

/**
 * `--prod` reads DATABASE_URL_PROD. Targeting production is an explicit flag on
 * the command line, not a consequence of which variable happens to be exported.
 */
function loadDatabaseUrl(useProd) {
  if (useProd) {
    const url =
      process.env.DATABASE_URL_PROD || readEnvFileKey("DATABASE_URL_PROD");
    if (!url) {
      throw new Error(
        "--prod given but DATABASE_URL_PROD is not set (checked the environment " +
          "and myth-server/.env)."
      );
    }
    return url;
  }

  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const url = readEnvFileKey("DATABASE_URL");
  if (!url) {
    throw new Error(
      "DATABASE_URL not set and not found in myth-server/.env. " +
        "Set DATABASE_URL in the environment or create .env."
    );
  }
  return url;
}

/** Host + database name only, never credentials. */
function describeTarget(connectionString) {
  try {
    const url = new URL(connectionString);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return "(unparseable connection string)";
  }
}

async function createAIUser() {
  const useProd = process.argv.includes("--prod");
  const connectionString = loadDatabaseUrl(useProd);
  const ssl =
    connectionString.includes("render.com") ||
    connectionString.includes("sslmode=require") ||
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false;

  console.log(
    `Target: ${describeTarget(connectionString)}${useProd ? "  [PRODUCTION]" : ""}`
  );

  const pool = new Pool({ connectionString, ssl });
  const client = await pool.connect();

  try {
    const { rows } = await client.query(
      `SELECT user_id FROM "users" WHERE user_id = $1`,
      [AI_PLAYER_ID]
    );

    if (rows.length > 0) {
      console.log("AI user already exists — nothing to do.");
      return;
    }

    // No need for a real password since the AI never logs in.
    await client.query(
      `INSERT INTO "users" (user_id, username, email, password_hash, in_game_currency, gold, gems, fate_coins, total_xp, pack_count, created_at, last_login)
       VALUES ($1, $2, $3, $4, 0, 0, 0, 2, 0, 10, NOW(), NOW())`,
      [AI_PLAYER_ID, AI_USERNAME, AI_EMAIL, "not_a_real_password"]
    );
    console.log("AI user created successfully");
  } finally {
    client.release();
    await pool.end();
  }
}

createAIUser().catch((error) => {
  console.error("Error creating AI user:", error.message);
  process.exit(1);
});
