#!/usr/bin/env node
/**
 * export-tower-portable.js — export the current tower to a PORTABLE, name-keyed
 * JSON manifest that can be re-created in ANOTHER environment (staging -> prod)
 * where card_variant_id UUIDs differ.
 *
 * Unlike export-tower.js (which dumps raw card_variant_id UUIDs and therefore
 * only works within the same DB), this export keys every card by its stable
 * CHARACTER NAME. The companion importer (import-tower-portable.js) re-resolves
 * those names to the TARGET environment's card_variant_id at import time.
 *
 * What it emits per floor:
 *   floor_number, name, deck_name, average_card_level, cards[]
 * where each card is { character_name, level, power_up_count, power_up_data }.
 * No UUIDs appear anywhere in the output.
 *
 * The chain walked (matches gen-tower-floors.js / wipe-tower.js):
 *   tower_floors.ai_deck_id -> deck_cards -> user_owned_cards.card_variant_id
 *     -> card_variants.character_id -> characters.name
 *
 * Usage:
 *   node scripts/export-tower-portable.js                       # -> tower-out/tower-portable.json
 *   node scripts/export-tower-portable.js my-floors.json        # custom output path
 *
 * DB connection: DATABASE_URL env var, else myth-server/.env (same as the
 * generator). This script only ever READS.
 */

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const AI_PLAYER_ID = "00000000-0000-0000-0000-000000000000";
const OUT_DIR = path.join(__dirname, "tower-out");

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

async function main() {
  const outArg = process.argv[2];
  const outPath = outArg
    ? path.resolve(outArg)
    : path.join(OUT_DIR, "tower-portable.json");

  const url = loadDatabaseUrl();
  const masked = url.replace(/:\/\/[^@]*@/, "://***@");
  const pool = makePool(url);

  console.log(`\n=== Tower portable export ===`);
  console.log(`DB: ${masked}\n`);

  try {
    // One row per (floor, card). power_up_data is the JSON blob stored on the
    // instance; character name is the stable cross-env key.
    const { rows } = await pool.query(
      `
      SELECT
        tf.floor_number,
        tf.name              AS floor_name,
        d.name               AS deck_name,
        tf.average_card_level,
        ch.name              AS character_name,
        uoc.level            AS level,
        ucp.power_up_count   AS power_up_count,
        ucp.power_up_data    AS power_up_data
      FROM tower_floors tf
      JOIN decks d              ON d.deck_id = tf.ai_deck_id
      JOIN deck_cards dc        ON dc.deck_id = tf.ai_deck_id
      JOIN user_owned_cards uoc ON uoc.user_card_instance_id = dc.user_card_instance_id
      JOIN card_variants cv     ON cv.card_variant_id = uoc.card_variant_id
      JOIN characters ch        ON ch.character_id = cv.character_id
      LEFT JOIN user_card_power_ups ucp
             ON ucp.user_card_instance_id = uoc.user_card_instance_id
      WHERE uoc.user_id = $1
      ORDER BY tf.floor_number, ch.name
      `,
      [AI_PLAYER_ID]
    );

    // Group rows into floors.
    const floorsByNumber = new Map();
    for (const r of rows) {
      let floor = floorsByNumber.get(r.floor_number);
      if (!floor) {
        floor = {
          floor_number: r.floor_number,
          name: r.floor_name,
          deck_name: r.deck_name,
          average_card_level:
            r.average_card_level === null ? null : Number(r.average_card_level),
          cards: [],
        };
        floorsByNumber.set(r.floor_number, floor);
      }
      floor.cards.push({
        character_name: r.character_name,
        level: r.level,
        power_up_count: r.power_up_count || 0,
        // power_up_data comes back as an object (jsonb) or null.
        power_up_data: r.power_up_data || null,
      });
    }

    const floors = [...floorsByNumber.values()].sort(
      (a, b) => a.floor_number - b.floor_number
    );

    // Distinct character names referenced — handy for a quick eyeball and for
    // the importer's pre-flight reconciliation.
    const distinctNames = [
      ...new Set(rows.map((r) => r.character_name)),
    ].sort((a, b) => a.localeCompare(b));

    const manifest = {
      generated_at: new Date().toISOString(),
      source_db: masked,
      floor_count: floors.length,
      card_row_count: rows.length,
      distinct_characters: distinctNames,
      floors,
    };

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));

    console.log(`✓ Exported portable tower manifest -> ${outPath}`);
    console.log(`  floors:              ${floors.length}`);
    console.log(`  card rows:           ${rows.length}`);
    console.log(`  distinct characters: ${distinctNames.length}`);

    const short = floors.filter((f) => f.cards.length !== 20);
    if (short.length > 0) {
      console.log(
        `\n  ⚠️  ${short.length} floor(s) do NOT have exactly 20 cards ` +
          `(floors: ${short.slice(0, 10).map((f) => f.floor_number).join(", ")}${
            short.length > 10 ? ", …" : ""
          }). Check before importing.`
      );
    }
    if (floors.length === 0) {
      console.log(`\n  ⚠️  No floors found — is this the right DB?`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
