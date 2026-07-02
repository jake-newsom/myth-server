#!/usr/bin/env node
/**
 * import-tower-portable.js — recreate a portable tower manifest (from
 * export-tower-portable.js) in the CURRENT target environment, re-resolving
 * each card's CHARACTER NAME to this environment's card_variant_id.
 *
 * This is the cross-environment counterpart to gen-tower-floors.js's SQL step:
 * it mints FRESH deck / instance / powerup / floor UUIDs on the target so there
 * are no ID collisions and no dependence on staging UUIDs.
 *
 * PROD SAFETY (by design):
 *   - Connection comes ONLY from the DATABASE_URL env var. It does NOT fall
 *     back to .env — so you must set DATABASE_URL=<prod> explicitly, and can't
 *     accidentally import into whatever .env happens to point at.
 *   - The masked host is printed on every run.
 *   - Nothing is written without --confirm. Default is a READ-ONLY --check.
 *
 * RESOLUTION (hard-fail): every card's character_name must resolve against the
 * target card pool (same filter as gen-tower-floors.js: one canonical
 * non-cosmetic variant per character, released_at <= NOW()). If ANY name does
 * not resolve, the run aborts and writes NOTHING — fix the manifest or release
 * the card on the target, then re-run.
 *
 * Usage:
 *   DATABASE_URL=<prod> node scripts/import-tower-portable.js            # --check (read-only)
 *   DATABASE_URL=<prod> node scripts/import-tower-portable.js --check    # explicit
 *   DATABASE_URL=<prod> node scripts/import-tower-portable.js --confirm  # writes
 *   DATABASE_URL=<prod> node scripts/import-tower-portable.js --confirm my-floors.json
 *
 * Run wipe-tower.js against the target FIRST (the floor inserts are guarded by
 * ON CONFLICT (floor_number) DO NOTHING, but a clean target avoids surprises).
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const AI_PLAYER_ID = "00000000-0000-0000-0000-000000000000";
const OUT_DIR = path.join(__dirname, "tower-out");
const newUuid = () => crypto.randomUUID();

const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
// Positional (non-flag) arg is the manifest path.
const manifestArg = args.find((a) => !a.startsWith("--"));

function loadDatabaseUrl() {
  // Intentionally NO .env fallback — prod must be explicit.
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required (no .env fallback for import). " +
        "Set it explicitly, e.g. DATABASE_URL=<target> node scripts/import-tower-portable.js"
    );
  }
  return process.env.DATABASE_URL;
}

function makePool(connectionString) {
  const ssl =
    connectionString.includes("render.com") || process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false;
  return new Pool({ connectionString, ssl });
}

/**
 * Target card pool, keyed by lower(character name). Mirrors fetchCardPool in
 * gen-tower-floors.js exactly so resolution matches the generator.
 */
async function fetchCardPoolByName(pool) {
  const { rows } = await pool.query(`
    SELECT DISTINCT ON (LOWER(ch.name))
        ch.name,
        cv.card_variant_id AS card_id
    FROM card_variants cv
    JOIN characters ch ON cv.character_id = ch.character_id
    WHERE cv.rarity::text NOT LIKE '%+'
      AND cv.released_at <= NOW()
      AND ch.released_at <= NOW()
    ORDER BY LOWER(ch.name), cv.card_variant_id
  `);
  const byName = new Map();
  for (const r of rows) byName.set(r.name.toLowerCase(), r.card_id);
  return byName;
}

function loadManifest() {
  const p = manifestArg
    ? path.resolve(manifestArg)
    : path.join(OUT_DIR, "tower-portable.json");
  if (!fs.existsSync(p)) {
    throw new Error(`Manifest not found: ${p}`);
  }
  const manifest = JSON.parse(fs.readFileSync(p, "utf8"));
  if (!Array.isArray(manifest.floors)) {
    throw new Error(`Manifest has no floors[] array: ${p}`);
  }
  return { manifest, path: p };
}

/**
 * Resolve every card in every floor against the target pool.
 * Returns { resolvedFloors, unresolved:Set<string> }.
 */
function resolveFloors(manifest, poolByName) {
  const unresolved = new Set();
  const resolvedFloors = [];

  for (const floor of manifest.floors) {
    const cards = [];
    for (const c of floor.cards || []) {
      const variantId = poolByName.get((c.character_name || "").toLowerCase());
      if (!variantId) {
        unresolved.add(c.character_name);
        continue;
      }
      cards.push({
        cardVariantId: variantId,
        level: Math.max(1, Math.floor(c.level || 1)),
        powerUpCount: c.power_up_count || 0,
        powerUpData: c.power_up_data || null,
      });
    }
    resolvedFloors.push({ ...floor, resolvedCards: cards });
  }
  return { resolvedFloors, unresolved };
}

function sqlStr(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

/**
 * Build one guarded, transactional WITH...INSERT statement for a floor, minting
 * fresh UUIDs. Same structure as buildFloorSql in gen-tower-floors.js.
 */
function buildFloorSql(floor) {
  const fn = floor.floor_number;
  const deckId = newUuid();
  const notExists = `NOT EXISTS (SELECT 1 FROM tower_floors WHERE floor_number = ${fn})`;

  const cardRows = floor.resolvedCards.map((c) => {
    const instanceId = newUuid();
    const hasPU = c.powerUpData && c.powerUpCount > 0;
    const puJson = hasPU ? sqlStr(JSON.stringify(c.powerUpData)) : "NULL";
    const puCount = hasPU ? c.powerUpCount : 0;
    return { instanceId, variantId: c.cardVariantId, level: c.level, puJson, puCount };
  });

  const cardValues = cardRows
    .map(
      (r) =>
        `    ('${r.instanceId}'::uuid, '${r.variantId}'::uuid, ${r.level}, ${r.puCount}, ${r.puJson}::jsonb)`
    )
    .join(",\n");

  const avg = floor.average_card_level === null ? "NULL" : floor.average_card_level;

  const lines = [];
  lines.push(`-- ===== Floor ${fn}: ${floor.name} =====`);
  lines.push(`WITH card_input (instance_id, card_variant_id, level, pu_count, pu_data) AS (`);
  lines.push(`  VALUES`);
  lines.push(cardValues);
  lines.push(`),`);
  lines.push(`new_deck AS (`);
  lines.push(`  INSERT INTO decks (deck_id, user_id, name, created_at, last_updated)`);
  lines.push(`  SELECT '${deckId}'::uuid, '${AI_PLAYER_ID}', ${sqlStr(floor.deck_name || floor.name)}, NOW(), NOW()`);
  lines.push(`  WHERE ${notExists}`);
  lines.push(`  RETURNING deck_id`);
  lines.push(`),`);
  lines.push(`ins_instances AS (`);
  lines.push(`  INSERT INTO user_owned_cards (user_card_instance_id, user_id, card_variant_id, level, xp, created_at)`);
  lines.push(`  SELECT ci.instance_id, '${AI_PLAYER_ID}', ci.card_variant_id, ci.level, 0, NOW()`);
  lines.push(`  FROM card_input ci`);
  lines.push(`  WHERE ${notExists}`);
  lines.push(`  RETURNING 1`);
  lines.push(`),`);
  lines.push(`ins_powerups AS (`);
  lines.push(`  INSERT INTO user_card_power_ups (user_card_instance_id, power_up_count, power_up_data)`);
  lines.push(`  SELECT ci.instance_id, ci.pu_count, ci.pu_data`);
  lines.push(`  FROM card_input ci`);
  lines.push(`  WHERE ci.pu_data IS NOT NULL AND ci.pu_count > 0 AND ${notExists}`);
  lines.push(`  RETURNING 1`);
  lines.push(`),`);
  lines.push(`ins_deck_cards AS (`);
  lines.push(`  INSERT INTO deck_cards (deck_id, user_card_instance_id)`);
  lines.push(`  SELECT '${deckId}'::uuid, ci.instance_id`);
  lines.push(`  FROM card_input ci`);
  lines.push(`  WHERE ${notExists}`);
  lines.push(`  RETURNING 1`);
  lines.push(`)`);
  lines.push(`INSERT INTO tower_floors (floor_number, name, ai_deck_id, average_card_level, is_active, created_at)`);
  lines.push(`SELECT ${fn}, ${sqlStr(floor.name)}, '${deckId}'::uuid, ${avg}, true, NOW()`);
  lines.push(`WHERE ${notExists}`);
  lines.push(`ON CONFLICT (floor_number) DO NOTHING;`);
  return lines.join("\n");
}

async function main() {
  const url = loadDatabaseUrl();
  const masked = url.replace(/:\/\/[^@]*@/, "://***@");
  const pool = makePool(url);

  console.log(`\n=== Tower portable import ===`);
  console.log(`DB: ${masked}`);
  console.log(`Mode: ${CONFIRM ? "CONFIRM (will write)" : "CHECK (read-only)"}\n`);

  try {
    const { manifest, path: manifestPath } = loadManifest();
    console.log(`Manifest: ${manifestPath}`);
    console.log(`  floors: ${manifest.floors.length}\n`);

    const poolByName = await fetchCardPoolByName(pool);
    console.log(`Target card pool: ${poolByName.size} distinct characters\n`);

    const { resolvedFloors, unresolved } = resolveFloors(manifest, poolByName);

    // Hard-fail on ANY unresolved character.
    if (unresolved.size > 0) {
      console.error(
        `✗ ${unresolved.size} character name(s) do NOT resolve on the target:\n`
      );
      for (const n of [...unresolved].sort()) console.error(`    - ${n}`);
      console.error(
        `\nAborted. No changes made. Release/rename these on the target ` +
          `(or fix the manifest), then re-run.`
      );
      process.exit(1);
    }

    // Report short decks (informational — resolution succeeded).
    const short = resolvedFloors.filter((f) => f.resolvedCards.length !== 20);
    console.log(`✓ All cards resolved.`);
    if (short.length > 0) {
      console.log(
        `  ⚠️  ${short.length} floor(s) have != 20 cards (from the source ` +
          `manifest, not a resolution failure): ` +
          short.slice(0, 10).map((f) => f.floor_number).join(", ") +
          (short.length > 10 ? ", …" : "")
      );
    }

    if (!CONFIRM) {
      console.log(`\nCheck complete. Re-run with --confirm to write to ${masked}.`);
      return;
    }

    // Write everything in one transaction. Each floor is a self-contained,
    // guarded statement, so a re-run is idempotent per floor_number.
    const client = await pool.connect();
    let inserted = 0;
    try {
      await client.query("BEGIN");
      for (const floor of resolvedFloors) {
        const stmt = buildFloorSql(floor);
        await client.query(stmt);
        inserted++;
      }
      await client.query("COMMIT");
      console.log(`\n✓ Imported ${inserted} floor(s) into ${masked}.`);
      console.log(`  Run verify-tower.js against the target to confirm.`);
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
