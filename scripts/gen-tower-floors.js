#!/usr/bin/env node
/**
 * gen-tower-floors.js — manual tower-floor generator (browser-Claude in the loop).
 *
 * Mirrors src/services/towerGeneration.service.ts but splits generation into two
 * manual steps so you can paste the prompt into Claude in the browser and feed
 * the JSON back. Generates floors in batches (default 5).
 *
 * WORKFLOW (one batch at a time):
 *
 *   1. node scripts/gen-tower-floors.js prompt <startFloor> [count]
 *        - Pulls the live card pool from the DB (excludes commons/uncommons
 *          past floor 50 and cosmetic + variants, exactly like the real
 *          generator), builds the prompt, and writes it to:
 *              scripts/tower-out/prompt.txt
 *        - Paste that into Claude in the browser.
 *
 *   2. Save Claude's JSON reply to:
 *              scripts/tower-out/response.json
 *
 *   3. node scripts/gen-tower-floors.js sql <startFloor> [count]
 *        - Reads response.json, validates card names + powerup totals against
 *          the DB, and writes guarded, transactional SQL to:
 *              scripts/tower-out/floors.sql
 *        - Run that SQL yourself (psql / your client). It is idempotent:
 *          floors that already exist are skipped (ON CONFLICT on the
 *          tower_floors primary key).
 *
 *   4. Repeat with the next startFloor (e.g. +5).
 *
 * The script only ever READS the DB. It never writes — you run the SQL.
 *
 * DB connection: reads DATABASE_URL from myth-server/.env (same var the server
 * uses). Override with DATABASE_URL in the environment if you want prod, etc.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const newUuid = () => crypto.randomUUID();

// ---------------------------------------------------------------------------
// Constants — kept in sync with towerGeneration.service.ts
// ---------------------------------------------------------------------------
const AI_PLAYER_ID = "00000000-0000-0000-0000-000000000000";
const CARDS_PER_DECK = 20;
const AI_MAX_LEGENDARY_CARDS = 4;
const AI_MAX_SAME_NAME_CARDS = 4;
const AI_POWERUPS_PER_LEVEL = 3;
const DEFAULT_BATCH = 5;

const MILESTONE_INTERVAL = 100;
const MILESTONE_SPIKE = 1.3;

const OUT_DIR = path.join(__dirname, "tower-out");
const PROMPT_PATH = path.join(OUT_DIR, "prompt.txt");
const RESPONSE_PATH = path.join(OUT_DIR, "response.json");
const SQL_PATH = path.join(OUT_DIR, "floors.sql");

// ---------------------------------------------------------------------------
// Scaling — mirrors calculateTargetAverageLevel in the service
// ---------------------------------------------------------------------------
function calculateTargetAverageLevel(floorNumber) {
  if (floorNumber <= 1) return 2.0;
  let base;
  if (floorNumber <= 50) base = 2.0 + (floorNumber - 1) * 0.05;
  else if (floorNumber <= 100) base = 4.5 + (floorNumber - 50) * 0.04;
  else if (floorNumber <= 200) base = 6.5 + (floorNumber - 100) * 0.04;
  else base = 10.5 + (floorNumber - 200) * 0.045;
  if (floorNumber % MILESTONE_INTERVAL === 0) base *= MILESTONE_SPIKE;
  return base;
}

function calculateMaxPowerups(level) {
  return Math.max(0, (level - 1) * AI_POWERUPS_PER_LEVEL);
}

// ---------------------------------------------------------------------------
// DB
// ---------------------------------------------------------------------------
function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) {
    throw new Error(
      "DATABASE_URL not set and myth-server/.env not found. " +
        "Set DATABASE_URL in the environment or create .env."
    );
  }
  const line = fs
    .readFileSync(envPath, "utf8")
    .split("\n")
    .find((l) => /^\s*DATABASE_URL\s*=/.test(l));
  if (!line) throw new Error("DATABASE_URL not found in .env");
  let val = line.slice(line.indexOf("=") + 1).trim();
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    val = val.slice(1, -1);
  }
  return val;
}

function makePool() {
  const connectionString = loadDatabaseUrl();
  const ssl =
    connectionString.includes("render.com") ||
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false;
  return new Pool({ connectionString, ssl });
}

/**
 * Pull the card pool. Returns one row per *character* (one canonical base,
 * non-cosmetic variant), matching how the real generator resolves names.
 */
async function fetchCardPool(pool) {
  const { rows } = await pool.query(`
    SELECT DISTINCT ON (LOWER(ch.name))
        ch.name,
        cv.rarity::text AS rarity,
        cv.card_variant_id AS card_id,
        COALESCE((ch.base_power->>'top')::int, 0)    AS top,
        COALESCE((ch.base_power->>'right')::int, 0)  AS "right",
        COALESCE((ch.base_power->>'bottom')::int, 0) AS bottom,
        COALESCE((ch.base_power->>'left')::int, 0)   AS "left",
        sa.name        AS ability_name,
        sa.description AS ability_description
    FROM card_variants cv
    JOIN characters ch ON cv.character_id = ch.character_id
    LEFT JOIN special_abilities sa ON ch.special_ability_id = sa.ability_id
    WHERE cv.rarity::text NOT LIKE '%+'
      AND cv.released_at <= NOW()
      AND ch.released_at <= NOW()
    ORDER BY LOWER(ch.name), cv.card_variant_id
  `);
  return rows.map((r) => ({
    name: r.name,
    rarity: r.rarity,
    card_id: r.card_id,
    base_power: { top: r.top, right: r.right, bottom: r.bottom, left: r.left },
    ability: r.ability_name
      ? { name: r.ability_name, description: r.ability_description }
      : null,
  }));
}

async function fetchReferenceDeck(pool, referenceFloor) {
  const floorRes = await pool.query(
    "SELECT floor_number, name, ai_deck_id FROM tower_floors WHERE floor_number = $1 AND is_active = true",
    [referenceFloor]
  );
  if (floorRes.rows.length === 0) return null;
  const { ai_deck_id } = floorRes.rows[0];

  const { rows } = await pool.query(
    `
    SELECT ch.name, uoc.level,
      COALESCE((ch.base_power->>'top')::int,0)
        + COALESCE((ucp.power_up_data->>'top')::int,0)    AS top,
      COALESCE((ch.base_power->>'right')::int,0)
        + COALESCE((ucp.power_up_data->>'right')::int,0)  AS "right",
      COALESCE((ch.base_power->>'bottom')::int,0)
        + COALESCE((ucp.power_up_data->>'bottom')::int,0) AS bottom,
      COALESCE((ch.base_power->>'left')::int,0)
        + COALESCE((ucp.power_up_data->>'left')::int,0)   AS "left"
    FROM deck_cards dc
    JOIN user_owned_cards uoc ON dc.user_card_instance_id = uoc.user_card_instance_id
    JOIN card_variants cv ON uoc.card_variant_id = cv.card_variant_id
    JOIN characters ch ON cv.character_id = ch.character_id
    LEFT JOIN user_card_power_ups ucp ON uoc.user_card_instance_id = ucp.user_card_instance_id
    WHERE dc.deck_id = $1
  `,
    [ai_deck_id]
  );
  if (rows.length === 0) return null;
  const cards = rows.map((r) => ({
    name: r.name,
    level: r.level,
    power: { top: r.top, right: r.right, bottom: r.bottom, left: r.left },
  }));
  const totalPower = cards.reduce(
    (s, c) => s + c.power.top + c.power.right + c.power.bottom + c.power.left,
    0
  );
  return {
    floor_number: referenceFloor,
    cards,
    average_power: cards.length ? totalPower / cards.length : 0,
  };
}

// ---------------------------------------------------------------------------
// Prompt building — mirrors buildGeminiPrompt
// ---------------------------------------------------------------------------
function buildPrompt(cardPool, referenceDeck, startFloor, count) {
  const deepFloors = startFloor > 50;

  // Exclude commons/uncommons from the *offered* pool past floor 50 so Claude
  // can't even pick them — matching the no-commons rule in the service.
  const offered = deepFloors
    ? cardPool.filter(
        (c) =>
          !/^common/i.test(c.rarity) && !/^uncommon/i.test(c.rarity)
      )
    : cardPool;

  const byRarity = {};
  for (const c of offered) {
    (byRarity[c.rarity] = byRarity[c.rarity] || []).push(c);
  }
  const cardListText = Object.entries(byRarity)
    .map(([rarity, cards]) => {
      const lines = cards
        .map((c) => {
          const p = `[${c.base_power.top}/${c.base_power.right}/${c.base_power.bottom}/${c.base_power.left}]`;
          const ab = c.ability ? ` - ${c.ability.name}: ${c.ability.description}` : "";
          return `  - ${c.name} ${p}${ab}`;
        })
        .join("\n");
      return `${rarity.toUpperCase()}:\n${lines}`;
    })
    .join("\n\n");

  const targetLevels = [];
  for (let i = 0; i < count; i++) {
    const f = startFloor + i;
    const gate = f % MILESTONE_INTERVAL === 0 ? "  (MILESTONE GATE)" : "";
    targetLevels.push(`Floor ${f}: ~${calculateTargetAverageLevel(f).toFixed(1)}${gate}`);
  }

  const referenceBlock = referenceDeck
    ? `REFERENCE DECK (Floor ${referenceDeck.floor_number}, Average Level: ${(
        referenceDeck.cards.reduce((s, c) => s + c.level, 0) /
        referenceDeck.cards.length
      ).toFixed(1)}, Average Power: ${referenceDeck.average_power.toFixed(1)}):
${referenceDeck.cards
  .map(
    (c) =>
      `  - ${c.name} (Level ${c.level}) [${c.power.top}/${c.power.right}/${c.power.bottom}/${c.power.left}]`
  )
  .join("\n")}
`
    : "(no reference deck available)\n";

  const rarityFloorRule = deepFloors
    ? "These are deep floors (>50): the card list above already EXCLUDES commons/uncommons. Build each deck ENTIRELY from rare, epic, and legendary cards. Do not invent commons."
    : "These are early floors (<=50): commons/uncommons are acceptable as filler, but prefer rare/epic where possible.";

  return `You are a game designer for a card battle game. Generate ${count} AI opponent decks for tower floors ${startFloor} to ${startFloor + count - 1}.

AVAILABLE CARDS:
${cardListText}

${referenceBlock}
TARGET AVERAGE LEVELS FOR THESE FLOORS:
${targetLevels.join("\n")}
(These are targets - you can vary by ±0.3, but try to stay close. Milestone-gate floors are intentionally harder.)

DECK CONSTRAINTS:
- Each deck must have exactly ${CARDS_PER_DECK} cards
- Maximum ${AI_MAX_LEGENDARY_CARDS} legendary cards per deck
- Maximum ${AI_MAX_SAME_NAME_CARDS} copies of the same card name
- Card levels can be any positive integer (no cap)

CARD RARITY FLOOR (IMPORTANT):
- ${rarityFloorRule}

POWERUP RULES (IMPORTANT):
- AI cards get ${AI_POWERUPS_PER_LEVEL} powerup points per level above 1
- Formula: max_powerups = (level - 1) × ${AI_POWERUPS_PER_LEVEL}
- Distribute these across the 4 edges (top, right, bottom, left)
- The 4 edge powerups must sum to AT MOST max_powerups

DECK DESIGN TIPS:
- Create synergistic decks with varied power levels
- Use higher-level legendary/epic cards as anchors
- Vary individual card levels (some powerhouses, some support)
- Consider card abilities when choosing levels
- Give each floor a creative, evocative name (3-6 words), never "Floor X"

OUTPUT FORMAT — output ONLY a JSON array, no other text:
[
  {
    "floor_number": ${startFloor},
    "floor_name": "The Frozen Wastes",
    "deck_name": "Frost Giants Deck",
    "cards": [
      { "card_name": "Exact Card Name", "level": 5, "power_ups": {"top": 2, "right": 4, "bottom": 0, "left": 0} }
    ]
  }
]

Use EXACT card names from the list above. Output exactly ${count} floors (${startFloor}..${startFloor + count - 1}).`;
}

// ---------------------------------------------------------------------------
// SQL building
// ---------------------------------------------------------------------------
function sqlStr(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

/**
 * Build one self-contained, guarded SQL statement per floor.
 *
 * Design notes (these matter for correctness):
 * - It's a single plain-SQL `WITH ... INSERT` statement, NOT a DO/PL-pgSQL
 *   block: a bare data-modifying CTE statement isn't valid as a PL/pgSQL
 *   statement, so a DO block would error at runtime.
 * - We pre-generate the deck_id and each user_card_instance_id in the script
 *   (as literal UUIDs). That means every downstream insert references a known
 *   id — we never depend on the order RETURNING happens to emit rows in
 *   (Postgres does NOT guarantee RETURNING follows the SELECT's ORDER BY), so
 *   the instance <-> powerup pairing can't scramble.
 * - Idempotency: the deck/instance/etc. inserts are all gated by
 *   `WHERE NOT EXISTS (SELECT 1 FROM tower_floors WHERE floor_number = N)`,
 *   so if the floor already exists NOTHING is inserted (no orphan decks), and
 *   the final tower_floors insert also has ON CONFLICT DO NOTHING as a belt.
 */
function buildFloorSql(floor, preparedCards, uuidFn) {
  const fn = floor.floor_number;
  const deckId = uuidFn();
  const lines = [];
  lines.push(`-- ===== Floor ${fn}: ${floor.floor_name} =====`);

  // Per-card pre-generated instance ids so all references are known up front.
  const cardRows = preparedCards.map((c) => {
    const instanceId = uuidFn();
    const hasPU =
      c.powerUps &&
      c.powerUps.top + c.powerUps.right + c.powerUps.bottom + c.powerUps.left > 0;
    const puJson = hasPU ? sqlStr(JSON.stringify(c.powerUps)) : "NULL";
    const puCount = hasPU
      ? c.powerUps.top + c.powerUps.right + c.powerUps.bottom + c.powerUps.left
      : 0;
    return {
      instanceId,
      variantId: c.cardVariantId,
      level: c.level,
      puJson,
      puCount,
      hasPU,
    };
  });

  const notExists = `NOT EXISTS (SELECT 1 FROM tower_floors WHERE floor_number = ${fn})`;

  // card_input carries the pre-generated instance id for each row.
  const cardValues = cardRows
    .map(
      (r) =>
        `    ('${r.instanceId}'::uuid, '${r.variantId}'::uuid, ${r.level}, ${r.puCount}, ${r.puJson}::jsonb)`
    )
    .join(",\n");

  lines.push(`WITH card_input (instance_id, card_variant_id, level, pu_count, pu_data) AS (`);
  lines.push(`  VALUES`);
  lines.push(cardValues);
  lines.push(`),`);
  lines.push(`new_deck AS (`);
  lines.push(`  INSERT INTO decks (deck_id, user_id, name, created_at, last_updated)`);
  lines.push(`  SELECT '${deckId}'::uuid, '${AI_PLAYER_ID}', ${sqlStr(floor.deck_name)}, NOW(), NOW()`);
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
  lines.push(`SELECT ${fn}, ${sqlStr(floor.floor_name)}, '${deckId}'::uuid, ${floor.average_card_level}, true, NOW()`);
  lines.push(`WHERE ${notExists}`);
  lines.push(`ON CONFLICT (floor_number) DO NOTHING;`);
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Response validation / normalization
// ---------------------------------------------------------------------------
function prepareFloor(floor, cardByName, deepFloors) {
  const warnings = [];
  const prepared = [];
  const usedNames = new Map();

  for (const card of floor.cards || []) {
    const key = (card.card_name || card.name || "").toLowerCase();
    const match = cardByName.get(key);
    if (!match) {
      warnings.push(`card not found: "${card.card_name || card.name}" (skipped)`);
      continue;
    }
    if (deepFloors && /^(common|uncommon)/i.test(match.rarity)) {
      warnings.push(`common/uncommon "${match.name}" on deep floor (skipped)`);
      continue;
    }
    const n = usedNames.get(key) || 0;
    if (n >= AI_MAX_SAME_NAME_CARDS) {
      warnings.push(`>${AI_MAX_SAME_NAME_CARDS} copies of "${match.name}" (extra skipped)`);
      continue;
    }

    const level = Math.max(1, Math.floor(card.level || 1));
    const maxPU = calculateMaxPowerups(level);
    let pu = card.power_ups || { top: 0, right: 0, bottom: 0, left: 0 };
    pu = {
      top: Math.max(0, Math.floor(pu.top || 0)),
      right: Math.max(0, Math.floor(pu.right || 0)),
      bottom: Math.max(0, Math.floor(pu.bottom || 0)),
      left: Math.max(0, Math.floor(pu.left || 0)),
    };
    const total = pu.top + pu.right + pu.bottom + pu.left;
    if (total > maxPU) {
      const scale = maxPU === 0 ? 0 : maxPU / total;
      pu = {
        top: Math.floor(pu.top * scale),
        right: Math.floor(pu.right * scale),
        bottom: Math.floor(pu.bottom * scale),
        left: Math.floor(pu.left * scale),
      };
      warnings.push(`"${match.name}" lvl ${level} powerups ${total}>${maxPU}, scaled down`);
    }

    usedNames.set(key, n + 1);
    prepared.push({ cardVariantId: match.card_id, level, powerUps: pu });
  }

  return { prepared, warnings };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
async function cmdPrompt(startFloor, count) {
  const pool = makePool();
  try {
    const cardPool = await fetchCardPool(pool);
    // Reference = the floor just below this batch, if it exists.
    const referenceDeck = await fetchReferenceDeck(pool, startFloor - 1);
    const prompt = buildPrompt(cardPool, referenceDeck, startFloor, count);
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(PROMPT_PATH, prompt);
    console.log(`Wrote prompt for floors ${startFloor}-${startFloor + count - 1} -> ${PROMPT_PATH}`);
    console.log(`Card pool: ${cardPool.length} characters` +
      (startFloor > 50 ? " (commons/uncommons excluded from prompt)" : ""));
    if (!referenceDeck) {
      console.log(`Note: no reference deck at floor ${startFloor - 1} (ok for the first batch).`);
    }
    console.log(`\nNext: paste ${PROMPT_PATH} into Claude, save the reply to ${RESPONSE_PATH}, then run:`);
    console.log(`  node scripts/gen-tower-floors.js sql ${startFloor} ${count}`);
  } finally {
    await pool.end();
  }
}

async function cmdSql(startFloor, count) {
  if (!fs.existsSync(RESPONSE_PATH)) {
    throw new Error(`Missing ${RESPONSE_PATH}. Paste Claude's JSON reply there first.`);
  }
  let raw = fs.readFileSync(RESPONSE_PATH, "utf8").trim();
  // Tolerate markdown fences / surrounding prose.
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  const arr = raw.match(/\[[\s\S]*\]/);
  if (arr) raw = arr[0];

  let floors;
  try {
    floors = JSON.parse(raw);
  } catch (e) {
    throw new Error(`response.json is not valid JSON: ${e.message}`);
  }
  if (!Array.isArray(floors)) throw new Error("Response is not a JSON array");

  const pool = makePool();
  try {
    const cardPool = await fetchCardPool(pool);
    const cardByName = new Map(cardPool.map((c) => [c.name.toLowerCase(), c]));

    const sqlChunks = [
      `-- Tower floors ${startFloor}-${startFloor + count - 1}`,
      `-- Generated ${new Date().toISOString()}`,
      `-- Idempotent: existing floors are skipped. Run inside a transaction.`,
      `BEGIN;`,
      ``,
    ];

    let emitted = 0;
    for (const floor of floors) {
      const fn = floor.floor_number;
      if (typeof fn !== "number") {
        console.warn(`Skipping a floor with no numeric floor_number`);
        continue;
      }
      if (fn < startFloor || fn >= startFloor + count) {
        console.warn(`Floor ${fn} is outside batch ${startFloor}-${startFloor + count - 1}, skipping`);
        continue;
      }
      const deepFloors = fn > 50;
      const { prepared, warnings } = prepareFloor(floor, cardByName, deepFloors);

      console.log(`\nFloor ${fn} (${floor.floor_name || "?"}): ${prepared.length} cards`);
      warnings.forEach((w) => console.log(`  ⚠️  ${w}`));
      if (prepared.length !== CARDS_PER_DECK) {
        console.log(`  ⚠️  expected ${CARDS_PER_DECK} cards, got ${prepared.length} — fix response.json and re-run, or accept.`);
      }
      if (prepared.length === 0) {
        console.log(`  ✗ no valid cards, floor skipped in SQL`);
        continue;
      }

      const totalLevel = prepared.reduce((s, c) => s + c.level, 0);
      const avgLevel = Math.round((totalLevel / prepared.length) * 10) / 10;
      sqlChunks.push(
        buildFloorSql(
          {
            floor_number: fn,
            floor_name: floor.floor_name || `Floor ${fn}`,
            deck_name: floor.deck_name || `${floor.floor_name || "Floor " + fn} Deck`,
            average_card_level: avgLevel,
          },
          prepared,
          newUuid
        )
      );
      emitted++;
    }

    sqlChunks.push(`COMMIT;`);
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(SQL_PATH, sqlChunks.join("\n"));
    console.log(`\nWrote ${emitted} floor(s) of SQL -> ${SQL_PATH}`);
    console.log(`Review it, then run it against your DB. Next batch:`);
    console.log(`  node scripts/gen-tower-floors.js prompt ${startFloor + count} ${count}`);
  } finally {
    await pool.end();
  }
}

// ---------------------------------------------------------------------------
async function main() {
  const [cmd, startArg, countArg] = process.argv.slice(2);
  const startFloor = parseInt(startArg, 10);
  const count = countArg ? parseInt(countArg, 10) : DEFAULT_BATCH;

  if (!cmd || !["prompt", "sql"].includes(cmd) || !Number.isInteger(startFloor)) {
    console.log(`Usage:
  node scripts/gen-tower-floors.js prompt <startFloor> [count=${DEFAULT_BATCH}]
  node scripts/gen-tower-floors.js sql    <startFloor> [count=${DEFAULT_BATCH}]

Files (in scripts/tower-out/):
  prompt.txt    <- generated; paste into Claude
  response.json <- you save Claude's JSON reply here
  floors.sql    <- generated; you run it against the DB`);
    process.exit(1);
  }

  if (cmd === "prompt") await cmdPrompt(startFloor, count);
  else await cmdSql(startFloor, count);
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
