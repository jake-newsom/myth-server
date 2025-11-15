require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const CLI_ARGS = process.argv.slice(2);
const DRY_RUN = CLI_ARGS.includes("--dry-run");

const LEVEL_INCREMENT_ORDER = ["top", "right", "bottom", "left"];

/**
 * Resolve the AI user's ID using AI_USER_ID or AI_USER_EMAIL
 */
async function resolveAiUserId(client) {
  const envId = '00000000-0000-0000-0000-000000000000';
  const envEmail = 'ai@mythgame.com';

  if (!envId && !envEmail) {
    throw new Error(
      "Missing AI_USER_ID or AI_USER_EMAIL. Please set one in your environment."
    );
  }

  if (envId) {
    const { rows } = await client.query(
      `SELECT user_id FROM users WHERE user_id = $1 LIMIT 1`,
      [envId]
    );
    if (!rows.length) {
      throw new Error(
        `AI user with id ${envId} not found. Double-check AI_USER_ID.`
      );
    }
    return rows[0].user_id;
  }

  const { rows } = await client.query(
    `SELECT user_id FROM users WHERE email = $1 ORDER BY created_at LIMIT 1`,
    [envEmail]
  );

  if (!rows.length) {
    throw new Error(
      `AI user with email ${envEmail} not found. Double-check AI_USER_EMAIL.`
    );
  }

  return rows[0].user_id;
}

/**
 * Try to extract the level info from a deck name (e.g. "AI Story ... (L3)" or "... Level 4")
 */
function parseDeckLevel(name = "") {
  if (!name) return null;

  const parenMatch = name.match(/\(L\s*(\d+)\)/i);
  if (parenMatch) {
    return parseInt(parenMatch[1], 10);
  }

  const levelWord = name.match(/level\s*(\d+)/i);
  if (levelWord) {
    return parseInt(levelWord[1], 10);
  }

  const shortMatch = name.match(/\bL\s*(\d+)/i);
  if (shortMatch) {
    return parseInt(shortMatch[1], 10);
  }

  return null;
}

/**
 * Load all AI decks (AI Story ... Level X)
 */
async function fetchAiDecks(client, aiUserId) {
  const { rows } = await client.query(
    `
      SELECT deck_id, name, COALESCE(last_updated, created_at) AS updated_at
      FROM decks
      WHERE user_id = $1
        AND (name ILIKE 'AI Story %' OR name ILIKE '%Level%')
      ORDER BY deck_id
    `,
    [aiUserId]
  );

  return rows.map((deck) => ({
    deck_id: deck.deck_id,
    name: deck.name,
    level: parseDeckLevel(deck.name) ?? 1,
    updated_at: deck.updated_at,
  }));
}

/**
 * Fetch all card instances used in the supplied deck IDs
 */
async function fetchDeckCardInstances(client, deckIds = []) {
  if (!deckIds.length) {
    return [];
  }

  const { rows } = await client.query(
    `
      SELECT
        dc.deck_id,
        dc.user_card_instance_id,
        uoc.level AS instance_level,
        uoc.card_id,
        c.power AS base_power
      FROM deck_cards dc
      JOIN user_owned_cards uoc ON uoc.user_card_instance_id = dc.user_card_instance_id
      JOIN cards c ON c.card_id = uoc.card_id
      WHERE dc.deck_id = ANY($1::uuid[])
    `,
    [deckIds]
  );

  return rows;
}

/**
 * Build power-up data for a given level
 */
function normalizeBasePower(basePower = {}) {
  const normalized = {};
  for (const side of LEVEL_INCREMENT_ORDER) {
    normalized[side] = Number(basePower?.[side]) || 0;
  }
  return normalized;
}

function determineSidePriority(basePower) {
  const normalized = normalizeBasePower(basePower);
  const orderedSides = LEVEL_INCREMENT_ORDER.map((side, index) => ({
    side,
    value: normalized[side],
    order: index,
  })).sort((a, b) => {
    if (b.value !== a.value) {
      return b.value - a.value;
    }
    return a.order - b.order;
  });

  const highest = orderedSides[0]?.side ?? "top";
  const lowest = orderedSides[orderedSides.length - 1]?.side ?? "bottom";
  const middle = orderedSides.slice(1, orderedSides.length - 1).map((entry) => entry.side);

  return { highest, lowest, middle, normalized };
}

function buildPowerUpData(level = 1, basePower = {}) {
  const boundedLevel = Math.max(1, Math.min(5, Number(level) || 1));
  const increments = {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  };

  const { highest, lowest, middle } = determineSidePriority(basePower);
  const apply = (side, amount) => {
    increments[side] = (increments[side] || 0) + amount;
  };

  switch (boundedLevel) {
    case 1:
      for (const side of LEVEL_INCREMENT_ORDER) {
        apply(side, 1);
      }
      break;
    case 2:
      apply(highest, 2);
      for (const side of LEVEL_INCREMENT_ORDER) {
        if (side !== highest) {
          apply(side, 1);
        }
      }
      break;
    case 3:
      apply(highest, 2);
      apply(lowest, 2);
      for (const side of LEVEL_INCREMENT_ORDER) {
        if (side !== highest && side !== lowest) {
          apply(side, 1);
        }
      }
      break;
    case 4:
      apply(highest, 3);
      apply(lowest, 2);
      for (const side of LEVEL_INCREMENT_ORDER) {
        if (side !== highest && side !== lowest) {
          apply(side, 1);
        }
      }
      break;
    case 5:
      apply(highest, 4);
      apply(lowest, 3);
      for (const side of LEVEL_INCREMENT_ORDER) {
        if (side !== highest && side !== lowest) {
          apply(side, 2);
        }
      }
      break;
    default:
      for (const side of LEVEL_INCREMENT_ORDER) {
        apply(side, 1);
      }
  }

  return { level: boundedLevel, data: increments };
}

/**
 * Prepare unique payload per user_card_instance_id
 */
function buildPowerUpPayload(deckCards, deckLevelMap) {
  const payloadMap = new Map();
  const mismatchedLevels = [];

  for (const card of deckCards) {
    const deckLevel = deckLevelMap.get(card.deck_id) ?? null;
    const instanceLevel = card.instance_level
      ? Number(card.instance_level)
      : null;
    const effectiveLevel = instanceLevel || deckLevel || 1;
    const basePower = card.base_power || {};

    if (deckLevel && instanceLevel && deckLevel !== instanceLevel) {
      mismatchedLevels.push({
        deckId: card.deck_id,
        deckLevel,
        instanceLevel,
        userCardInstanceId: card.user_card_instance_id,
      });
    }

    const current = payloadMap.get(card.user_card_instance_id);

    if (!current || effectiveLevel > current.level) {
      payloadMap.set(card.user_card_instance_id, {
        user_card_instance_id: card.user_card_instance_id,
        level: effectiveLevel,
        base_power: basePower,
      });
    }
  }

  return {
    payload: Array.from(payloadMap.values()),
    mismatchedLevels,
  };
}

/**
 * Insert/Update power-up records in batches
 */
async function upsertPowerUps(client, records, chunkSize = 100) {
  if (!records.length) {
    return 0;
  }

  let affected = 0;

  for (let i = 0; i < records.length; i += chunkSize) {
    const chunk = records.slice(i, i + chunkSize);

    const params = [];
    const valuesSql = chunk
      .map((record, index) => {
        const baseIndex = index * 3;
        params.push(
          record.user_card_instance_id,
          record.power_up_count,
          JSON.stringify(record.power_up_data)
        );
        return `($${baseIndex + 1}, $${baseIndex + 2}, $${
          baseIndex + 3
        }::jsonb)`;
      })
      .join(", ");

    const result = await client.query(
      `
        INSERT INTO user_card_power_ups (user_card_instance_id, power_up_count, power_up_data)
        VALUES ${valuesSql}
        ON CONFLICT (user_card_instance_id) DO UPDATE
          SET power_up_count = EXCLUDED.power_up_count,
              power_up_data = EXCLUDED.power_up_data,
              updated_at = NOW()
        RETURNING user_card_instance_id
      `,
      params
    );

    affected += result.rowCount;
  }

  return affected;
}

async function main() {
  const client = await pool.connect();

  try {
    console.log("⚡ Populating AI power-ups...");
    console.log(`   Dry run: ${DRY_RUN ? "yes" : "no"}`);

    const aiUserId = await resolveAiUserId(client);
    console.log(`   AI user: ${aiUserId}`);

    const decks = await fetchAiDecks(client, aiUserId);
    if (!decks.length) {
      console.log(
        "No AI decks found. Did you run the story deck seeding script yet?"
      );
      return;
    }

    console.log(`   Decks found: ${decks.length}`);

    const deckLevelMap = new Map(decks.map((deck) => [deck.deck_id, deck.level]));
    const deckIds = decks.map((deck) => deck.deck_id);

    const deckCards = await fetchDeckCardInstances(client, deckIds);
    if (!deckCards.length) {
      console.log("No deck cards found for AI decks.");
      return;
    }

    console.log(`   Deck cards found: ${deckCards.length}`);

    const { payload, mismatchedLevels } = buildPowerUpPayload(
      deckCards,
      deckLevelMap
    );

    if (mismatchedLevels.length) {
      console.warn(
        `⚠️  Detected ${mismatchedLevels.length} deck/card level mismatches (using instance level).`
      );
    }

    const enrichedPayload = payload.map((record) => {
      const { data, level } = buildPowerUpData(record.level, record.base_power);
      return {
        user_card_instance_id: record.user_card_instance_id,
        power_up_count: Object.values(data).reduce(
          (sum, value) => sum + Number(value || 0),
          0
        ),
        power_up_data: data,
        level,
      };
    });

    console.log(
      `   Unique card instances to process: ${enrichedPayload.length}`
    );

    if (DRY_RUN) {
      console.log("Dry run enabled — skipping database writes.");
      return;
    }

    await client.query("BEGIN");
    const affected = await upsertPowerUps(client, enrichedPayload);
    await client.query("COMMIT");

    console.log(`✅ Power-ups upserted: ${affected}`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("❌ Error populating power-ups:", error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

module.exports = {
  main,
  fetchAiDecks,
  fetchDeckCardInstances,
  buildPowerUpPayload,
  buildPowerUpData,
};

