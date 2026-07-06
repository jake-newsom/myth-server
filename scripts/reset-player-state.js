#!/usr/bin/env node
/**
 * reset-player-state.js — end-of-beta full reset of all HUMAN player state.
 *
 * Wipes, in FK-safe order and inside a single transaction:
 *   - game history (game_results, games)
 *   - fate picks (participations + picks) and pack opening history
 *   - mail
 *   - season progress (reward payouts, soul contributions, mythology
 *     choices + aggregate totals)
 *   - saga progress (saga_runs cascades saga_cards/saga_decks/
 *     saga_collections; plus saga_player_seasons)
 *   - decks + deck_cards, owned cards (+ power-ups via cascade), XP pools,
 *     xp transfers
 *   - owned borders and card backs
 *   - achievements, daily task progress, monthly login progress,
 *     shop purchases, rankings, sessions
 *   - users row: all currencies/XP/packs -> 0, win_streak_multiplier -> 1,
 *     tower_floor -> 1
 *
 * PRESERVED:
 *   - user accounts themselves (username/email/auth/role)
 *   - friendships
 *   - the AI player (00000000-…) and everything it owns — tower + saga
 *     enemy decks and their cards live under that user, so every per-user
 *     delete is scoped to user_id != AI. Do NOT switch these to TRUNCATE.
 *   - all content tables (characters, card_variants, sets, achievements,
 *     tower_floors, shop config/rotations, seasons, etc.)
 *   - daily_task_selections (server-wide daily rotation, not per-user)
 *
 * After the wipe (unless --no-starters), re-grants starter content to every
 * remaining human user via the SAME StarterService used at registration
 * (starter cards, Starter Deck, starter packs), so existing accounts come
 * out identical to a fresh signup.
 *
 * Usage:
 *   node scripts/reset-player-state.js               # dry run: counts only
 *   node scripts/reset-player-state.js --confirm     # actually reset
 *   node scripts/reset-player-state.js --confirm --no-starters
 *   node scripts/reset-player-state.js --confirm --reset-tutorials
 *
 * DB connection: DATABASE_URL env var, else myth-server/.env (same as
 * wipe-tower.js). For prod, set DATABASE_URL explicitly:
 *   DATABASE_URL="postgresql://..." node scripts/reset-player-state.js
 */

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const AI_PLAYER_ID = "00000000-0000-0000-0000-000000000000";

const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const NO_STARTERS = args.includes("--no-starters");
const RESET_TUTORIALS = args.includes("--reset-tutorials");

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) {
    throw new Error("DATABASE_URL not set and .env not found.");
  }
  const line = fs
    .readFileSync(envPath, "utf8")
    .split("\n")
    .find((l) => /^\s*DATABASE_URL\s*=/.test(l));
  if (!line) throw new Error("DATABASE_URL not found in .env");
  let v = line.slice(line.indexOf("=") + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v;
}

function makePool(connectionString) {
  const ssl =
    connectionString.includes("render.com") || process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false;
  return new Pool({ connectionString, ssl });
}

// [table, WHERE clause or null for all rows] — execution order matters (FKs).
const WIPE_STEPS = [
  ["game_results", null],
  ["games", null],
  ["fate_pick_participations", null],
  ["fate_picks", null],
  ["pack_opening_history", null],
  ["mail", null],
  ["season_reward_payouts", null],
  ["season_soul_contributions", null],
  ["season_mythology_choices", null],
  ["season_mythology_totals", null],
  // cascades saga_cards, saga_decks, saga_collections
  ["saga_runs", `player_id != '${AI_PLAYER_ID}'`],
  ["saga_player_seasons", `player_id != '${AI_PLAYER_ID}'`],
  // cascades deck_cards; AI decks (tower + saga enemies) must survive
  ["decks", `user_id != '${AI_PLAYER_ID}'`],
  // cascades user_card_power_ups
  ["user_owned_cards", `user_id != '${AI_PLAYER_ID}'`],
  ["xp_transfers", `user_id != '${AI_PLAYER_ID}'`],
  ["user_card_xp_pools", `user_id != '${AI_PLAYER_ID}'`],
  ["user_owned_borders", `user_id != '${AI_PLAYER_ID}'`],
  ["user_owned_card_backs", `user_id != '${AI_PLAYER_ID}'`],
  ["user_achievements", `user_id != '${AI_PLAYER_ID}'`],
  ["user_daily_task_progress", `user_id != '${AI_PLAYER_ID}'`],
  ["user_monthly_login_progress", `user_id != '${AI_PLAYER_ID}'`],
  ["daily_shop_purchases", `user_id != '${AI_PLAYER_ID}'`],
  ["user_rankings", `user_id != '${AI_PLAYER_ID}'`],
  ["user_sessions", null],
];

function resetUsersSql() {
  const tutorialReset = RESET_TUTORIALS
    ? `, tutorial_completed_at = NULL,
       completed_feature_tutorials = '{}'`
    : "";
  return `
    UPDATE users SET
      in_game_currency = 0,
      gold = 0,
      gems = 0,
      fate_coins = 0,
      card_fragments = 0,
      echoes = 0,
      total_xp = 0,
      pack_count = 0,
      win_streak_multiplier = 1,
      tower_floor = 1,
      tower_floor_updated_at = NULL${tutorialReset}
    WHERE user_id != '${AI_PLAYER_ID}'`;
}

async function main() {
  const dbUrl = loadDatabaseUrl();
  // Make sure the app's db.config (used by StarterService below) hits the
  // same database this script is wiping.
  process.env.DATABASE_URL = dbUrl;

  const host = new URL(dbUrl).host;
  console.log(`Target database: ${host}`);
  console.log(CONFIRM ? "MODE: LIVE (--confirm)" : "MODE: dry run (pass --confirm to execute)");

  const pool = makePool(dbUrl);
  const client = await pool.connect();
  try {
    const humans = await client.query(
      `SELECT user_id, username FROM users WHERE user_id != $1 ORDER BY username`,
      [AI_PLAYER_ID]
    );
    console.log(`\nHuman users to reset: ${humans.rows.length}`);
    for (const u of humans.rows) console.log(`  - ${u.username} (${u.user_id})`);

    console.log("\nRows per table:");
    for (const [table, where] of WIPE_STEPS) {
      const res = await client.query(
        `SELECT count(*)::int AS n FROM ${table}${where ? ` WHERE ${where}` : ""}`
      );
      console.log(`  ${table.padEnd(30)} ${res.rows[0].n}`);
    }

    if (!CONFIRM) {
      console.log("\nDry run complete. Nothing was changed.");
      return;
    }

    console.log("\nWiping player state...");
    await client.query("BEGIN");
    for (const [table, where] of WIPE_STEPS) {
      const res = await client.query(
        `DELETE FROM ${table}${where ? ` WHERE ${where}` : ""}`
      );
      console.log(`  deleted ${String(res.rowCount).padStart(6)} from ${table}`);
    }
    const upd = await client.query(resetUsersSql());
    console.log(`  reset currencies/xp/tower on ${upd.rowCount} users`);
    await client.query("COMMIT");
    console.log("Wipe committed.");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    throw err;
  } finally {
    client.release();
  }

  if (CONFIRM && !NO_STARTERS) {
    console.log("\nRe-granting starter content (same path as registration)...");
    require("ts-node/register/transpile-only");
    const StarterService = require("../src/services/starter.service").default;

    const { rows } = await pool.query(
      `SELECT user_id, username FROM users WHERE user_id != $1`,
      [AI_PLAYER_ID]
    );
    for (const u of rows) {
      await StarterService.grantStarterContent(u.user_id);
      console.log(`  granted starter cards/deck/packs to ${u.username}`);
    }
    // StarterService uses the app's own pool; close it so the process exits.
    const appDb = require("../src/config/db.config").default;
    if (appDb.pool && appDb.pool.end) await appDb.pool.end();
  }

  await pool.end();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Reset failed:", err);
  process.exit(1);
});
