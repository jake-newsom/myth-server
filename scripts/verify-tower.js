#!/usr/bin/env node
/**
 * verify-tower.js — invariant checks on the rebuilt tower. Read-only.
 *
 * Run after importing/generating floors, before trusting the data or
 * exporting to prod. Exits non-zero if any hard check fails.
 *
 * Checks:
 *   1. Floor coverage: floors 1..MAX are contiguous (no gaps/dupes).
 *   2. Every floor's AI deck has exactly 20 cards.
 *   3. Every floor references a real, AI-owned deck (no dangling ai_deck_id).
 *   4. No commons/uncommons in AI decks past floor 50.
 *   5. No orphaned AI tower cards (owned_cards not referenced by any deck_card).
 *   6. Powerup totals never exceed (level-1)*3 for AI cards.
 *   7. Average card level roughly tracks the expected curve (warning only).
 *
 * Usage:
 *   node scripts/verify-tower.js              # expects floors 1..max contiguous
 *   node scripts/verify-tower.js 1 500        # assert exact range 1..500
 */

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const AI_PLAYER_ID = "00000000-0000-0000-0000-000000000000";
const CARDS_PER_DECK = 20;
const AI_POWERUPS_PER_LEVEL = 3;
const MILESTONE_INTERVAL = 100;
const MILESTONE_SPIKE = 1.3;
// Deep floors eased because Encounter Modifiers now add difficulty past 100.
// Keep in sync with towerGeneration.service.ts and gen-tower-floors.js.
const DEEP_FLOOR_EASE = 0.9;

function expectedLevel(f) {
  if (f <= 1) return 2.0;
  let base;
  if (f <= 50) base = 2.0 + (f - 1) * 0.05;
  else if (f <= 100) base = 4.5 + (f - 50) * 0.04;
  else if (f <= 200) base = (6.5 + (f - 100) * 0.04) * DEEP_FLOOR_EASE;
  else base = (10.5 + (f - 200) * 0.045) * DEEP_FLOOR_EASE;
  if (f % MILESTONE_INTERVAL === 0) base *= MILESTONE_SPIKE;
  return base;
}

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

function makePool(cs) {
  const ssl =
    cs.includes("render.com") || process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false;
  return new Pool({ connectionString: cs, ssl });
}

async function main() {
  const wantMin = process.argv[2] ? parseInt(process.argv[2], 10) : null;
  const wantMax = process.argv[3] ? parseInt(process.argv[3], 10) : null;

  const url = loadDatabaseUrl();
  const pool = makePool(url);
  const fails = [];
  const warns = [];

  try {
    // 1. Coverage
    const cov = await pool.query(
      `SELECT MIN(floor_number) AS lo, MAX(floor_number) AS hi, COUNT(*)::int AS n FROM tower_floors`
    );
    const { lo, hi, n } = cov.rows[0];
    console.log(`Floors: ${n} (range ${lo}..${hi})`);
    if (n === 0) {
      fails.push("no tower floors exist");
    } else {
      if (hi - lo + 1 !== n) fails.push(`floor numbers not contiguous: ${n} rows span ${lo}..${hi}`);
      if (wantMin !== null && lo !== wantMin) fails.push(`min floor ${lo}, expected ${wantMin}`);
      if (wantMax !== null && hi !== wantMax) fails.push(`max floor ${hi}, expected ${wantMax}`);
    }

    // 3. Dangling deck refs
    const dangling = await pool.query(`
      SELECT tf.floor_number
      FROM tower_floors tf
      LEFT JOIN decks d ON d.deck_id = tf.ai_deck_id AND d.user_id = $1
      WHERE d.deck_id IS NULL
      ORDER BY tf.floor_number
    `, [AI_PLAYER_ID]);
    if (dangling.rows.length > 0) {
      fails.push(`${dangling.rows.length} floor(s) with missing/non-AI deck: ${dangling.rows.slice(0, 10).map((r) => r.floor_number).join(", ")}${dangling.rows.length > 10 ? "…" : ""}`);
    }

    // 2. Deck sizes
    const sizes = await pool.query(`
      SELECT tf.floor_number, COUNT(dc.user_card_instance_id)::int AS cards
      FROM tower_floors tf
      LEFT JOIN deck_cards dc ON dc.deck_id = tf.ai_deck_id
      GROUP BY tf.floor_number
      HAVING COUNT(dc.user_card_instance_id) <> ${CARDS_PER_DECK}
      ORDER BY tf.floor_number
    `);
    if (sizes.rows.length > 0) {
      fails.push(`${sizes.rows.length} floor(s) not ${CARDS_PER_DECK} cards: ` +
        sizes.rows.slice(0, 10).map((r) => `${r.floor_number}=${r.cards}`).join(", ") +
        (sizes.rows.length > 10 ? "…" : ""));
    }

    // 4. Commons past floor 50
    const commons = await pool.query(`
      SELECT tf.floor_number, COUNT(*)::int AS bad
      FROM tower_floors tf
      JOIN deck_cards dc ON dc.deck_id = tf.ai_deck_id
      JOIN user_owned_cards uoc ON uoc.user_card_instance_id = dc.user_card_instance_id
      JOIN card_variants cv ON cv.card_variant_id = uoc.card_variant_id
      WHERE tf.floor_number > 50
        AND (cv.rarity::text ILIKE 'common%' OR cv.rarity::text ILIKE 'uncommon%')
      GROUP BY tf.floor_number
      ORDER BY tf.floor_number
    `);
    if (commons.rows.length > 0) {
      fails.push(`${commons.rows.length} deep floor(s) contain commons/uncommons: ` +
        commons.rows.slice(0, 10).map((r) => `${r.floor_number}(${r.bad})`).join(", ") +
        (commons.rows.length > 10 ? "…" : ""));
    }

    // 6. Powerup overflow
    const puOverflow = await pool.query(`
      SELECT tf.floor_number, uoc.level, ucp.power_up_count
      FROM tower_floors tf
      JOIN deck_cards dc ON dc.deck_id = tf.ai_deck_id
      JOIN user_owned_cards uoc ON uoc.user_card_instance_id = dc.user_card_instance_id
      JOIN user_card_power_ups ucp ON ucp.user_card_instance_id = uoc.user_card_instance_id
      WHERE ucp.power_up_count > (uoc.level - 1) * ${AI_POWERUPS_PER_LEVEL}
      LIMIT 10
    `);
    if (puOverflow.rows.length > 0) {
      fails.push(`${puOverflow.rows.length}+ card(s) exceed powerup cap (e.g. floor ${puOverflow.rows[0].floor_number}, lvl ${puOverflow.rows[0].level}, pu ${puOverflow.rows[0].power_up_count})`);
    }

    // 5. Orphaned AI tower cards: AI-owned cards whose deck is a tower deck but
    // that aren't in any deck_cards row. (Leak detection.)
    const orphans = await pool.query(`
      SELECT COUNT(*)::int AS n
      FROM user_owned_cards uoc
      WHERE uoc.user_id = $1
        AND NOT EXISTS (SELECT 1 FROM deck_cards dc WHERE dc.user_card_instance_id = uoc.user_card_instance_id)
    `, [AI_PLAYER_ID]);
    if (orphans.rows[0].n > 0) {
      warns.push(`${orphans.rows[0].n} AI-owned card(s) not in any deck (possible leak from prior resets; not necessarily tower)`);
    }

    // 7. Level curve sanity (warning only) — sample milestone floors.
    const curve = await pool.query(`
      SELECT tf.floor_number, AVG(uoc.level)::numeric(10,1) AS avg_level
      FROM tower_floors tf
      JOIN deck_cards dc ON dc.deck_id = tf.ai_deck_id
      JOIN user_owned_cards uoc ON uoc.user_card_instance_id = dc.user_card_instance_id
      WHERE tf.floor_number IN (1, 50, 100, 200, 300, 400, 500)
      GROUP BY tf.floor_number
      ORDER BY tf.floor_number
    `);
    console.log(`\nLevel curve (sampled):`);
    for (const r of curve.rows) {
      const exp = expectedLevel(r.floor_number);
      const got = Number(r.avg_level);
      const off = Math.abs(got - exp) / exp;
      const flag = off > 0.4 ? "  ⚠️ off >40%" : "";
      console.log(`  floor ${String(r.floor_number).padStart(3)}: avg ${got.toFixed(1)} (expected ~${exp.toFixed(1)})${flag}`);
      if (off > 0.4) warns.push(`floor ${r.floor_number} avg level ${got} far from expected ${exp.toFixed(1)}`);
    }

    // 8. Encounter Modifiers (hard failures — a malformed modifier can make a
    //    floor unenterable, so these are not warnings).
    const KNOWN_MODIFIER_TYPES = [
      "max_budget",
      "single_set",
      "no_tag",
      "no_legendary",
      "poison",
    ];
    const KNOWN_SETS = ["norse", "japanese", "polynesian"];
    // god/human are deliberately not bannable: too large a share of the pool.
    const BANNABLE_TAGS = [
      "war", "sea", "mystic", "spirit", "nature", "trickster", "sky",
      "beast", "dragon", "underworld", "fire", "ice", "demon", "giant",
    ];

    const modRows = await pool.query(`
      SELECT floor_number, modifiers
      FROM tower_floors
      WHERE modifiers IS NOT NULL
      ORDER BY floor_number
    `);

    let modFloors = 0;
    for (const r of modRows.rows) {
      const mods = r.modifiers;
      if (!Array.isArray(mods)) {
        fails.push(`floor ${r.floor_number}: modifiers is not an array`);
        continue;
      }
      if (mods.length === 0) continue;
      modFloors++;

      if (mods.length > 2) {
        fails.push(`floor ${r.floor_number}: ${mods.length} modifiers (max 2)`);
      }
      if (r.floor_number <= 100) {
        fails.push(`floor ${r.floor_number}: modifiers below floor 100`);
      }
      if (r.floor_number % 5 !== 0) {
        fails.push(`floor ${r.floor_number}: modifiers on a non-multiple of 5`);
      }

      const restrictions = mods.filter((m) => m && m.type !== "poison");
      if (restrictions.length > 1) {
        fails.push(
          `floor ${r.floor_number}: ${restrictions.length} deck restrictions (max 1) — can make the floor unenterable`
        );
      }

      for (const m of mods) {
        if (!m || !KNOWN_MODIFIER_TYPES.includes(m.type)) {
          fails.push(`floor ${r.floor_number}: unknown modifier type "${m && m.type}"`);
          continue;
        }
        if (!m.label || !m.description) {
          fails.push(`floor ${r.floor_number}: ${m.type} missing label/description`);
        }
        if (m.type === "single_set" && !KNOWN_SETS.includes(m.value)) {
          fails.push(`floor ${r.floor_number}: unknown set "${m.value}"`);
        }
        if (m.type === "no_tag" && !BANNABLE_TAGS.includes(m.value)) {
          fails.push(`floor ${r.floor_number}: tag "${m.value}" is not bannable`);
        }
        if (m.type === "max_budget" && !(Number(m.value) > 0)) {
          fails.push(`floor ${r.floor_number}: invalid budget "${m.value}"`);
        }
      }
    }
    console.log(`\nEncounter modifiers: ${modFloors} floor(s) configured`);

    // Report
    console.log(`\n${"=".repeat(40)}`);
    if (warns.length) {
      console.log(`WARNINGS (${warns.length}):`);
      warns.forEach((w) => console.log(`  ⚠️  ${w}`));
    }
    if (fails.length) {
      console.log(`\nFAILED (${fails.length}):`);
      fails.forEach((f) => console.log(`  ✗ ${f}`));
      console.log(`\n✗ Tower verification FAILED.`);
      process.exitCode = 1;
    } else {
      console.log(`✓ Tower verification PASSED${warns.length ? ` (${warns.length} warning(s))` : ""}.`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
