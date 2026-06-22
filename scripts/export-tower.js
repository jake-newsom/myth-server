#!/usr/bin/env node
/**
 * export-tower.js — export the current (rebuilt) tower data to a single SQL
 * file that can be imported into another environment (dev -> prod).
 *
 * Exports the AI-scoped tower rows:
 *   decks (referenced by tower_floors.ai_deck_id)
 *   user_owned_cards (AI instances in those decks)
 *   user_card_power_ups (for those instances)
 *   deck_cards (for those decks)
 *   tower_floors (all)
 *
 * The output is ordered so a fresh import satisfies FKs, and is wrapped so it
 * is safe to run against a freshly-wiped target (run wipe-tower.js on the
 * target FIRST). Insert order: decks -> owned_cards -> power_ups -> deck_cards
 * -> tower_floors.
 *
 * Usage:
 *   node scripts/export-tower.js                 # -> scripts/tower-out/tower-export.sql
 *   node scripts/export-tower.js my-floors.sql   # custom output path
 *
 * IMPORTANT: import into a target that has been wiped (no existing tower
 * floors/AI decks), otherwise PK/unique collisions will abort the import.
 */

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const AI_PLAYER_ID = "00000000-0000-0000-0000-000000000000";
const OUT_DIR = path.join(__dirname, "tower-out");

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) throw new Error("DATABASE_URL not set and .env not found.");
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

function rowsToInsert(table, rows, fields) {
  if (rows.length === 0) return `-- ${table}: 0 rows`;
  const cols = fields.map((f) => `"${f.name}"`).join(", ");
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
  return `INSERT INTO ${table} (${cols}) VALUES\n${values};`;
}

async function main() {
  const outArg = process.argv[2];
  const outPath = outArg
    ? path.resolve(outArg)
    : path.join(OUT_DIR, "tower-export.sql");

  const url = loadDatabaseUrl();
  const pool = makePool(url);

  try {
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
         WHERE dc.deck_id = ANY($1::uuid[]) AND uoc.user_id = $2`,
        [deckIds, AI_PLAYER_ID]
      );
      instanceIds = instRes.rows.map((r) => r.user_card_instance_id);
    }

    const q = async (sql, params) => {
      const res = await pool.query(sql, params);
      return { rows: res.rows, fields: res.fields };
    };

    const decks = await q(`SELECT * FROM decks WHERE deck_id = ANY($1::uuid[])`, [deckIds]);
    const owned = await q(
      `SELECT * FROM user_owned_cards WHERE user_card_instance_id = ANY($1::uuid[])`,
      [instanceIds]
    );
    const powerups = await q(
      `SELECT * FROM user_card_power_ups WHERE user_card_instance_id = ANY($1::uuid[])`,
      [instanceIds]
    );
    const deckCards = await q(`SELECT * FROM deck_cards WHERE deck_id = ANY($1::uuid[])`, [deckIds]);
    const floors = await q(`SELECT * FROM tower_floors ORDER BY floor_number`, []);

    const out = [
      `-- Tower export generated ${new Date().toISOString()}`,
      `-- Floors: ${floors.rows.length}, AI decks: ${deckIds.length}, AI cards: ${instanceIds.length}`,
      `-- Import into a WIPED target (run wipe-tower.js there first).`,
      `BEGIN;`,
      ``,
      rowsToInsert("decks", decks.rows, decks.fields),
      ``,
      rowsToInsert("user_owned_cards", owned.rows, owned.fields),
      ``,
      rowsToInsert("user_card_power_ups", powerups.rows, powerups.fields),
      ``,
      rowsToInsert("deck_cards", deckCards.rows, deckCards.fields),
      ``,
      rowsToInsert("tower_floors", floors.rows, floors.fields),
      ``,
      `COMMIT;`,
      ``,
    ].join("\n");

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, out);

    console.log(`✓ Exported tower data -> ${outPath}`);
    console.log(`  floors: ${floors.rows.length}`);
    console.log(`  decks: ${decks.rows.length}`);
    console.log(`  owned_cards: ${owned.rows.length}`);
    console.log(`  power_ups: ${powerups.rows.length}`);
    console.log(`  deck_cards: ${deckCards.rows.length}`);
    if (floors.rows.length > 0 && decks.rows.length === 0) {
      console.log(`  ⚠️  floors exist but no decks matched — check ai_deck_id integrity.`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
