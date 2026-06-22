#!/usr/bin/env node
/**
 * wipe-tower.js — destructively remove ALL tower floors and their AI data.
 *
 * Deletes, in FK-safe order and inside a single transaction:
 *   1. tower_floors (all rows)
 *   2. the AI decks those floors referenced (decks.deck_id = tower_floors.ai_deck_id)
 *        -> cascades deck_cards (ON DELETE CASCADE)
 *   3. the AI user_owned_cards that belonged to those decks
 *        -> cascades user_card_power_ups (ON DELETE CASCADE)
 *
 * SCOPING (important): only decks referenced by tower_floors.ai_deck_id are
 * touched. The AI player (00000000-…) also owns SAGA enemy decks; scoping by
 * user_id alone would wrongly delete those. We capture the tower deck IDs
 * BEFORE deleting the floors.
 *
 * Before deleting it:
 *   - writes a pg_dump backup of the current tower rows to
 *       scripts/tower-out/tower-backup-<timestamp>.sql
 *   - aborts any in-progress tower games (game_status='active' AND
 *     floor_number IS NOT NULL -> 'aborted') so no in-flight game is left
 *     pointing at a deleted AI deck (player2_deck_id is ON DELETE SET NULL).
 *
 * Player progress (users.tower_floor) is intentionally NOT reset here — beta
 * reset is handled separately. Pass --reset-progress to also set every user
 * back to floor 1.
 *
 * Usage:
 *   node scripts/wipe-tower.js              # dry run: report what WOULD happen
 *   node scripts/wipe-tower.js --confirm    # actually wipe
 *   node scripts/wipe-tower.js --confirm --reset-progress
 *   node scripts/wipe-tower.js --confirm --no-backup
 *
 * DB connection: DATABASE_URL env var, else myth-server/.env (same as the
 * generator). For prod, set DATABASE_URL explicitly.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { Pool } = require("pg");

const AI_PLAYER_ID = "00000000-0000-0000-0000-000000000000";
const OUT_DIR = path.join(__dirname, "tower-out");

const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const NO_BACKUP = args.includes("--no-backup");
const RESET_PROGRESS = args.includes("--reset-progress");

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

/**
 * Back up current tower rows via pg_dump (data-only, specific tables won't
 * work because we need a *filtered* subset, so we dump with a temp approach:
 * pg_dump can't filter rows, so we instead export via COPY in the script).
 * To keep it dependency-free and row-filtered, we generate INSERT statements
 * ourselves from the live rows.
 */
async function backupTowerRows(pool, deckIds, instanceIds) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(OUT_DIR, `tower-backup-${stamp}.sql`);

  const chunks = [
    `-- Tower backup taken ${new Date().toISOString()}`,
    `-- Restores: tower_floors, AI decks, AI user_owned_cards, user_card_power_ups, deck_cards`,
    `BEGIN;`,
    ``,
  ];

  const dump = async (label, sql, params) => {
    const { rows, fields } = await pool.query(sql, params);
    if (rows.length === 0) {
      chunks.push(`-- ${label}: 0 rows`);
      return;
    }
    const cols = fields.map((f) => `"${f.name}"`).join(", ");
    const table = label;
    const values = rows
      .map((r) => {
        const vals = fields.map((f) => {
          const v = r[f.name];
          if (v === null || v === undefined) return "NULL";
          if (typeof v === "number") return String(v);
          if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
          if (v instanceof Date) return `'${v.toISOString()}'`;
          if (typeof v === "object") return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
          return `'${String(v).replace(/'/g, "''")}'`;
        });
        return `  (${vals.join(", ")})`;
      })
      .join(",\n");
    chunks.push(`INSERT INTO ${table} (${cols}) VALUES\n${values};`);
    chunks.push("");
  };

  // Order chosen so a restore satisfies FKs: decks -> owned_cards -> power_ups -> deck_cards -> tower_floors
  await dump(
    "decks",
    `SELECT * FROM decks WHERE deck_id = ANY($1::uuid[])`,
    [deckIds]
  );
  await dump(
    "user_owned_cards",
    `SELECT * FROM user_owned_cards WHERE user_card_instance_id = ANY($1::uuid[])`,
    [instanceIds]
  );
  await dump(
    "user_card_power_ups",
    `SELECT * FROM user_card_power_ups WHERE user_card_instance_id = ANY($1::uuid[])`,
    [instanceIds]
  );
  await dump(
    "deck_cards",
    `SELECT * FROM deck_cards WHERE deck_id = ANY($1::uuid[])`,
    [deckIds]
  );
  await dump("tower_floors", `SELECT * FROM tower_floors`, []);

  chunks.push(`COMMIT;`);
  fs.writeFileSync(file, chunks.join("\n"));
  return file;
}

async function main() {
  const url = loadDatabaseUrl();
  const masked = url.replace(/:\/\/[^@]*@/, "://***@");
  const pool = makePool(url);

  console.log(`\n=== Tower wipe ===`);
  console.log(`DB: ${masked}`);
  console.log(`Mode: ${CONFIRM ? "CONFIRM (will delete)" : "DRY RUN (no changes)"}`);
  console.log(`Backup: ${NO_BACKUP ? "skipped" : "yes"}`);
  console.log(`Reset progress: ${RESET_PROGRESS ? "yes" : "no"}\n`);

  try {
    // 1. Capture tower deck IDs and their AI card instance IDs BEFORE deleting.
    const deckRes = await pool.query(
      `SELECT ai_deck_id FROM tower_floors WHERE ai_deck_id IS NOT NULL`
    );
    const deckIds = [...new Set(deckRes.rows.map((r) => r.ai_deck_id))];

    let instanceIds = [];
    if (deckIds.length > 0) {
      const instRes = await pool.query(
        `SELECT DISTINCT dc.user_card_instance_id
         FROM deck_cards dc
         JOIN user_owned_cards uoc ON uoc.user_card_instance_id = dc.user_card_instance_id
         WHERE dc.deck_id = ANY($1::uuid[])
           AND uoc.user_id = $2`,
        [deckIds, AI_PLAYER_ID]
      );
      instanceIds = instRes.rows.map((r) => r.user_card_instance_id);
    }

    const floorCountRes = await pool.query(`SELECT COUNT(*)::int AS n FROM tower_floors`);
    const activeGamesRes = await pool.query(
      `SELECT COUNT(*)::int AS n FROM games
       WHERE floor_number IS NOT NULL AND game_status = 'active'`
    );

    console.log(`Tower floors:        ${floorCountRes.rows[0].n}`);
    console.log(`AI tower decks:      ${deckIds.length}`);
    console.log(`AI card instances:   ${instanceIds.length}`);
    console.log(`Active tower games:  ${activeGamesRes.rows[0].n} (will be cancelled)\n`);

    if (!CONFIRM) {
      console.log("Dry run complete. Re-run with --confirm to apply.");
      return;
    }

    // 2. Backup (read-only) before any deletes.
    if (!NO_BACKUP) {
      const file = await backupTowerRows(pool, deckIds, instanceIds);
      console.log(`✓ Backup written: ${file}\n`);
    }

    // 3. Destructive work in one transaction.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Abort in-flight tower games so none ends up with a null AI deck.
      // ('aborted' is the terminal-cancel value in the game_status enum;
      // the enum has no 'cancelled'.)
      const cancelled = await client.query(
        `UPDATE games SET game_status = 'aborted'
         WHERE floor_number IS NOT NULL AND game_status = 'active'`
      );
      console.log(`✓ Aborted ${cancelled.rowCount} active tower game(s)`);

      // Delete floors first (nothing FK-depends on tower_floors).
      const delFloors = await client.query(`DELETE FROM tower_floors`);
      console.log(`✓ Deleted ${delFloors.rowCount} tower floor(s)`);

      // Delete AI owned cards -> cascades user_card_power_ups.
      // (Also cascades their deck_cards rows.)
      if (instanceIds.length > 0) {
        const delCards = await client.query(
          `DELETE FROM user_owned_cards
           WHERE user_card_instance_id = ANY($1::uuid[]) AND user_id = $2`,
          [instanceIds, AI_PLAYER_ID]
        );
        console.log(`✓ Deleted ${delCards.rowCount} AI card instance(s) (power-ups cascaded)`);
      }

      // Delete the AI decks -> cascades any remaining deck_cards.
      if (deckIds.length > 0) {
        const delDecks = await client.query(
          `DELETE FROM decks WHERE deck_id = ANY($1::uuid[]) AND user_id = $2`,
          [deckIds, AI_PLAYER_ID]
        );
        console.log(`✓ Deleted ${delDecks.rowCount} AI tower deck(s)`);
      }

      if (RESET_PROGRESS) {
        const reset = await client.query(`UPDATE users SET tower_floor = 1 WHERE tower_floor <> 1`);
        console.log(`✓ Reset ${reset.rowCount} user(s) to floor 1`);
      }

      await client.query("COMMIT");
      console.log(`\n✓ Wipe complete.`);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
