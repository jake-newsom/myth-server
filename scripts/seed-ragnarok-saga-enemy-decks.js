/**
 * Seed Sagas Season 1 (Ragnarök) enemy AI decks from GDD deck definitions.
 *
 * Creates 14 AI decks (10 unique Norse cards ? 2 copies = 20 cards each) and
 * optionally wires them into saga_seasons.enemy_decks for season_id ragnarok_s1.
 *
 * Source: Sagas_S1_Enemy_Deck_Definitions.md
 *
 * Usage:
 *   node scripts/seed-ragnarok-saga-enemy-decks.js
 *   node scripts/seed-ragnarok-saga-enemy-decks.js --replace
 *   node scripts/seed-ragnarok-saga-enemy-decks.js --update-season
 *   node scripts/seed-ragnarok-saga-enemy-decks.js --replace --update-season
 */

require("dotenv").config();

const { Pool } = require("pg");

const AI_PLAYER_ID = "00000000-0000-0000-0000-000000000000";
const DECK_NAME_PREFIX = "Saga S1:";
const SEASON_ID = "ragnarok_s1";
const NORSE_SET_NAME = "norse";
const SHOP_PACK_MAX_PER_SEASON = 5;

const SEASON_CARD_BACK = {
  code_key: "ragnarok_s1_card_back",
  name: "Ragnarök",
  // Card backs resolve directly through assetManager (no implicit "cards/" prefix),
  // so keep the canonical patch path including "cards/".
  image_url: "cards/backs/ragnarok.webp",
};

const SEASON_CARD_BORDER = {
  name: "Ragnarök",
  image_url: "borders/ragnarok.webp",
  animation_key: "ragnarok_flame",
};

const SEASON_BOSS_CARD = {
  character_name: "Ragnarök",
  type: "boss",
  base_power: { top: 9, right: 9, bottom: 9, left: 9 },
  // "boss" lets findBossOpeningCardInstanceId (sagaBattle.service.ts) identify
  // this card to guarantee it's in the AI's opening hand and played first.
  tags: ["event", "boss"],
  rarity: "legendary++",
  image_url: "ragnarok/ragnarok.webp",
  attack_animation: "fire",
};

const RAGNAROK_ABILITY = {
  id: "ragnarok_worlds_end",
  name: "Ragnarök",
  description:
    "Fill empty tiles on the board with lava for 1 round. GOD cards in both players hand lose 1 power each round.",
};

const SEASON_VARIANTS = [
  {
    character_name: "Odin",
    rarity: "legendary+",
    image_url: "ragnarok/odin-ragnarok.webp",
    attack_animation: "lightning",
  },
  {
    character_name: "Thor",
    rarity: "legendary+",
    image_url: "ragnarok/thor-ragnarok.webp",
    attack_animation: "lightning",
  },
  {
    character_name: "Loki",
    rarity: "epic+",
    image_url: "ragnarok/loki-ragnarok.webp",
    attack_animation: "curse",
  },
  {
    character_name: "Fenrir",
    rarity: "legendary+",
    image_url: "ragnarok/fenrir-ragnarok.webp",
    attack_animation: "slash",
  },
  {
    character_name: "Hel",
    rarity: "epic+",
    image_url: "ragnarok/hel-ragnarok.webp",
    attack_animation: "curse",
  },
  {
    character_name: "Heimdall",
    rarity: "rare+",
    image_url: "ragnarok/heimdall-ragnarok.webp",
    attack_animation: "shield",
  },
  {
    character_name: "Surtr",
    rarity: "legendary+",
    image_url: "ragnarok/surtr-ragnarok.webp",
    attack_animation: "fire",
  },
  {
    character_name: "Jörmungandr",
    rarity: "legendary+",
    image_url: "ragnarok/jormungandr-ragnarok.webp",
  },
];

/** Map design-doc names to catalog character names when they differ. */
const CARD_NAME_ALIASES = {
  "Ragnarök (Season Card)": "Ragnarök",
  "Jormungandr": "Jörmungandr",
};

/**
 * @type {Array<{ id: string; floor: number; name: string; cards: string[] }>}
 */
const DECK_DEFINITIONS = [
  {
    id: "1A",
    floor: 1,
    name: "Hel's Grasp",
    cards: [
      "Hel",
      "Baldr",
      "Frigg",
      "Heimdall",
      "Sigurd",
      "Freyja",
      "Bear Totem",
      "Drenger",
      "Shieldmaiden",
      "Torchbearer",
    ],
  },
  {
    id: "1B",
    floor: 1,
    name: "Skadi's Frost",
    cards: [
      "Skadi",
      "Ran",
      "Njord",
      "Bragi",
      "Freyja",
      "Norse Fox",
      "Berserker",
      "Ice Fisher",
      "Raven Scout",
      "Young Jarl",
    ],
  },
  {
    id: "1C",
    floor: 1,
    name: "Tyr's Warband",
    cards: [
      "Tyr",
      "Heimdall",
      "Bragi",
      "Frigg",
      "Sigurd",
      "Bear Totem",
      "Shieldmaiden",
      "Drenger",
      "Norse Fox",
      "Torchbearer",
    ],
  },
  {
    id: "1-BOSS",
    floor: 1,
    name: "Fenrir Unchained",
    cards: [
      "Fenrir",
      "Baldr",
      "Hel",
      "Frigg",
      "Freyja",
      "Heimdall",
      "Berserker",
      "Bear Totem",
      "Shieldmaiden",
      "Drenger",
    ],
  },
  {
    id: "2A",
    floor: 2,
    name: "Frost Giant's March",
    cards: [
      "Skadi",
      "Tyr",
      "Ran",
      "Heimdall",
      "Bragi",
      "Njord",
      "Sigurd",
      "Berserker",
      "Norse Fox",
      "Ice Fisher",
    ],
  },
  {
    id: "2B",
    floor: 2,
    name: "Surtr's Vanguard",
    cards: [
      "Surtr",
      "Thor",
      "Fenrir",
      "Skadi",
      "Baldr",
      "Freyja",
      "Bear Totem",
      "Shieldmaiden",
      "Thrall",
      "Runestone Keeper",
    ],
  },
  {
    id: "2C",
    floor: 2,
    name: "Odin's Court",
    cards: [
      "Odin",
      "Vidar",
      "Frigg",
      "Bragi",
      "Freyja",
      "Baldr",
      "Sigurd",
      "Drenger",
      "Raven Scout",
      "Torchbearer",
    ],
  },
  {
    id: "2D",
    floor: 2,
    name: "The Serpent's Coil",
    cards: [
      "Jörmungandr",
      "Loki",
      "Ran",
      "Hel",
      "Heimdall",
      "Njord",
      "Norse Fox",
      "Ice Fisher",
      "Young Jarl",
      "Runestone Keeper",
    ],
  },
  {
    id: "2-BOSS",
    floor: 2,
    name: "Jormungandr Rises",
    cards: [
      "Jörmungandr",
      "Loki",
      "Odin",
      "Ran",
      "Njord",
      "Skadi",
      "Heimdall",
      "Baldr",
      "Shieldmaiden",
      "Berserker",
    ],
  },
  {
    id: "3A",
    floor: 3,
    name: "The Einherjar",
    cards: [
      "Odin",
      "Vidar",
      "Thor",
      "Frigg",
      "Bragi",
      "Freyja",
      "Baldr",
      "Heimdall",
      "Shieldmaiden",
      "Drenger",
    ],
  },
  {
    id: "3B",
    floor: 3,
    name: "Loki's Deception",
    cards: [
      "Loki",
      "Hel",
      "Tyr",
      "Ran",
      "Skadi",
      "Njord",
      "Sigurd",
      "Berserker",
      "Norse Fox",
      "Raven Scout",
    ],
  },
  {
    id: "3C",
    floor: 3,
    name: "Surtr's Inferno",
    cards: [
      "Surtr",
      "Fenrir",
      "Thor",
      "Vidar",
      "Skadi",
      "Baldr",
      "Frigg",
      "Bear Totem",
      "Thrall",
      "Runestone Keeper",
    ],
  },
  {
    id: "3D",
    floor: 3,
    name: "Twilight of the Gods",
    cards: [
      "Odin",
      "Vidar",
      "Tyr",
      "Hel",
      "Loki",
      "Heimdall",
      "Ran",
      "Freyja",
      "Torchbearer",
      "Young Jarl",
    ],
  },
  {
    id: "3-BOSS",
    floor: 3,
    name: "Ragnarök",
    cards: [
      "Ragnarök",
      "Surtr",
      "Thor",
      "Loki",
      "Fenrir",
      "Odin",
      "Vidar",
      "Hel",
      "Jörmungandr",
      "Baldr",
    ],
  },
];

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_URL?.includes("render.com") ||
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

function deckDisplayName(def) {
  return `${DECK_NAME_PREFIX} ${def.id} - ${def.name}`;
}

function resolveCardName(name) {
  return CARD_NAME_ALIASES[name] ?? name;
}

function isLegendaryRarity(rarity) {
  return String(rarity).toLowerCase().startsWith("legendary");
}

function parseArgs(argv) {
  return {
    replace: argv.includes("--replace"),
    updateSeason: argv.includes("--update-season"),
  };
}

async function getNorseSet(client) {
  const { rows } = await client.query(
    `SELECT set_id, name
     FROM sets
     WHERE LOWER(TRIM(name)) = $1
     LIMIT 1`,
    [NORSE_SET_NAME]
  );
  if (!rows.length) {
    throw new Error(`Could not find set "${NORSE_SET_NAME}"`);
  }
  return rows[0];
}

async function findCharacterByName(client, characterName) {
  const { rows } = await client.query(
    `SELECT character_id, special_ability_id
     FROM characters
     WHERE name = $1
     LIMIT 1`,
    [characterName]
  );
  return rows[0] || null;
}

async function loadCardBackRow(client, backId) {
  const { rows } = await client.query(
    `SELECT back_id, code_key, name, image_url
     FROM card_backs
     WHERE back_id = $1`,
    [backId]
  );
  if (!rows.length) {
    throw new Error(`Card back ${backId} not found after ensure`);
  }
  return rows[0];
}

async function ensureCardBack(client) {
  const existing = await client.query(
    `SELECT back_id, image_url
     FROM card_backs
     WHERE code_key = $1
     LIMIT 1`,
    [SEASON_CARD_BACK.code_key]
  );
  if (existing.rows.length > 0) {
    if (existing.rows[0].image_url !== SEASON_CARD_BACK.image_url) {
      await client.query(
        `UPDATE card_backs
         SET image_url = $2,
             is_active = true,
             updated_at = NOW()
         WHERE back_id = $1`,
        [existing.rows[0].back_id, SEASON_CARD_BACK.image_url]
      );
      console.log(
        `Updated seasonal card back image_url -> ${SEASON_CARD_BACK.image_url}`
      );
    }
    return loadCardBackRow(client, existing.rows[0].back_id);
  }

  const inserted = await client.query(
    `INSERT INTO card_backs (code_key, name, image_url, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, true, NOW(), NOW())
     RETURNING back_id`,
    [
      SEASON_CARD_BACK.code_key,
      SEASON_CARD_BACK.name,
      SEASON_CARD_BACK.image_url,
    ]
  );
  console.log(`Created seasonal card back: ${SEASON_CARD_BACK.name}`);
  return loadCardBackRow(client, inserted.rows[0].back_id);
}

async function loadCardBorderRow(client, borderId) {
  const { rows } = await client.query(
    `SELECT border_id, name, image_url
     FROM card_borders
     WHERE border_id = $1`,
    [borderId]
  );
  if (!rows.length) {
    throw new Error(`Card border ${borderId} not found after ensure`);
  }
  return rows[0];
}

async function ensureCardBorder(client, _setId) {
  const existing = await client.query(
    `SELECT border_id
     FROM card_borders
     WHERE name = $1
     LIMIT 1`,
    [SEASON_CARD_BORDER.name]
  );
  if (existing.rows.length > 0) {
    // Keep this border globally equip-able by clearing set/character restrictions.
    await client.query(
      `UPDATE card_borders
       SET image_url = $2,
           animation_key = $3,
           character_id = NULL,
           set_id = NULL,
           is_active = true,
           updated_at = NOW()
       WHERE border_id = $1`,
      [
        existing.rows[0].border_id,
        SEASON_CARD_BORDER.image_url,
        SEASON_CARD_BORDER.animation_key,
      ]
    );
    return loadCardBorderRow(client, existing.rows[0].border_id);
  }

  const inserted = await client.query(
    `INSERT INTO card_borders (
       name, description, image_url, animation_key, character_id, set_id,
       is_active, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, NULL, NULL, true, NOW(), NOW())
     RETURNING border_id`,
    [
      SEASON_CARD_BORDER.name,
      "Season 1 exclusive border",
      SEASON_CARD_BORDER.image_url,
      SEASON_CARD_BORDER.animation_key,
    ]
  );
  console.log(`Created seasonal card border: ${SEASON_CARD_BORDER.name}`);
  return loadCardBorderRow(client, inserted.rows[0].border_id);
}

async function loadCardVariantShopRow(client, cardVariantId) {
  const { rows } = await client.query(
    `SELECT
       cv.card_variant_id,
       cv.image_url,
       cv.rarity,
       ch.name AS character_name
     FROM card_variants cv
     JOIN characters ch ON cv.character_id = ch.character_id
     WHERE cv.card_variant_id = $1`,
    [cardVariantId]
  );
  if (!rows.length) {
    throw new Error(`Card variant ${cardVariantId} not found after ensure`);
  }
  return rows[0];
}

async function ensureSeasonBossCard(client, setId) {
  const ragnarokAbility = await client.query(
    `INSERT INTO special_abilities (id, name, description, trigger_moments, parameters)
     VALUES ($1, $2, $3, ARRAY['OnPlace','OnRoundStart']::trigger_moment[], '{}'::jsonb)
     ON CONFLICT (id)
     DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       trigger_moments = EXCLUDED.trigger_moments,
       parameters = EXCLUDED.parameters
     RETURNING ability_id`,
    [RAGNAROK_ABILITY.id, RAGNAROK_ABILITY.name, RAGNAROK_ABILITY.description]
  );
  const ragnarokAbilityId = ragnarokAbility.rows[0].ability_id;

  const existingCharacter = await findCharacterByName(
    client,
    SEASON_BOSS_CARD.character_name
  );
  let characterId = existingCharacter?.character_id ?? null;
  if (!characterId) {
    const insertedCharacter = await client.query(
      `INSERT INTO characters (
         name, description, type, base_power, special_ability_id, set_id, tags,
         created_at, updated_at
       )
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::text[], NOW(), NOW())
       RETURNING character_id`,
      [
        SEASON_BOSS_CARD.character_name,
        `Ragnarök is the story of the end of the world in Norse mythology. It begins after a long, terrible winter called Fimbulwinter, when the sun disappears, the cold becomes harsh, and people turn against each other. The gods know that a great battle is coming, but they cannot stop it. Powerful enemies, including giants and monsters, break free and march toward Asgard, the home of the gods.

In the final battle, many famous figures face their enemies. Odin fights the giant wolf Fenrir, Thor battles the huge serpent Jormungandr, and Loki joins the enemies of the gods. The fighting is fierce, and many gods and monsters die. The world is then covered in fire and swallowed by the sea, making it seem like everything has ended.

But Ragnarök is not only a story about destruction. After the world is ruined, it rises again, fresh and green. A few gods survive, and two humans live through the disaster and help begin the human race again. The story shows that even after terrible loss, life can return and a new beginning is possible.`,
        SEASON_BOSS_CARD.type,
        JSON.stringify(SEASON_BOSS_CARD.base_power),
        ragnarokAbilityId,
        setId,
        SEASON_BOSS_CARD.tags,
      ]
    );
    characterId = insertedCharacter.rows[0].character_id;
    console.log(`Created seasonal boss character: ${SEASON_BOSS_CARD.character_name}`);
  } else {
    await client.query(
      `UPDATE characters
       SET special_ability_id = $2,
           set_id = $3,
           tags = $4::text[],
           updated_at = NOW()
       WHERE character_id = $1`,
      [characterId, ragnarokAbilityId, setId, SEASON_BOSS_CARD.tags]
    );
  }

  const existingVariant = await client.query(
    `SELECT card_variant_id
     FROM card_variants
     WHERE character_id = $1 AND is_exclusive = true
     LIMIT 1`,
    [characterId]
  );
  if (existingVariant.rows.length > 0) {
    await client.query(
      `UPDATE card_variants
       SET rarity = $2,
           image_url = $3,
           attack_animation = $4,
           is_exclusive = true
       WHERE card_variant_id = $1`,
      [
        existingVariant.rows[0].card_variant_id,
        SEASON_BOSS_CARD.rarity,
        SEASON_BOSS_CARD.image_url,
        SEASON_BOSS_CARD.attack_animation,
      ]
    );
    return loadCardVariantShopRow(
      client,
      existingVariant.rows[0].card_variant_id
    );
  }

  const insertedVariant = await client.query(
    `INSERT INTO card_variants (
       character_id, rarity, image_url, attack_animation, is_exclusive, released_at, created_at
     )
     VALUES ($1, $2, $3, $4, true, NOW(), NOW())
     RETURNING card_variant_id`,
    [
      characterId,
      SEASON_BOSS_CARD.rarity,
      SEASON_BOSS_CARD.image_url,
      SEASON_BOSS_CARD.attack_animation,
    ]
  );
  console.log(`Created seasonal boss variant: ${SEASON_BOSS_CARD.image_url}`);
  return loadCardVariantShopRow(
    client,
    insertedVariant.rows[0].card_variant_id
  );
}

async function ensureSeasonVariants(client) {
  const variantIds = [];

  for (const variantDef of SEASON_VARIANTS) {
    const character = await findCharacterByName(client, variantDef.character_name);
    if (!character) {
      throw new Error(
        `Character "${variantDef.character_name}" not found while creating seasonal variants`
      );
    }

    const existing = await client.query(
      `SELECT card_variant_id
       FROM card_variants
       WHERE character_id = $1 AND is_exclusive = true
       LIMIT 1`,
      [character.character_id]
    );

    if (existing.rows.length > 0) {
      await client.query(
        `UPDATE card_variants
         SET rarity = $2,
             image_url = $3,
             attack_animation = $4,
             is_exclusive = true
         WHERE card_variant_id = $1`,
        [
          existing.rows[0].card_variant_id,
          variantDef.rarity,
          variantDef.image_url,
          variantDef.attack_animation ?? null,
        ]
      );
      variantIds.push(
        await loadCardVariantShopRow(client, existing.rows[0].card_variant_id)
      );
      continue;
    }

    const inserted = await client.query(
      `INSERT INTO card_variants (
         character_id, rarity, image_url, attack_animation, is_exclusive, released_at, created_at
       )
       VALUES ($1, $2, $3, $4, true, NOW(), NOW())
       RETURNING card_variant_id`,
      [
        character.character_id,
        variantDef.rarity,
        variantDef.image_url,
        variantDef.attack_animation ?? null,
      ]
    );
    variantIds.push(
      await loadCardVariantShopRow(client, inserted.rows[0].card_variant_id)
    );
    console.log(
      `Created seasonal variant for ${variantDef.character_name}: ${variantDef.image_url}`
    );
  }

  return variantIds;
}

function buildCardShopItem({ id, type, row, cost, description }) {
  const isBoss = type === "seasonal_card";
  return {
    id,
    type,
    name: isBoss ? row.character_name : `${row.character_name} Variant`,
    cost,
    max_quantity: 1,
    ...(description ? { description } : {}),
    preview_image_url: row.image_url,
    metadata: {
      card_variant_id: row.card_variant_id,
    },
  };
}

function buildSeasonShopItems({
  bossRow,
  cardBackRow,
  borderRow,
  variantRows,
}) {
  const shopItems = [
    buildCardShopItem({
      id: "ragnarok_s1_boss_card",
      type: "seasonal_card",
      row: bossRow,
      cost: 400,
      description: `Exclusive ${bossRow.character_name} season boss card.`,
    }),
    {
      id: "ragnarok_s1_card_back",
      type: "card_back",
      name: cardBackRow.name,
      cost: 100,
      max_quantity: 1,
      preview_image_url: cardBackRow.image_url,
      metadata: {
        card_back_code_key: cardBackRow.code_key,
      },
    },
    {
      id: "ragnarok_s1_card_border",
      type: "card_border",
      name: borderRow.name,
      cost: 75,
      max_quantity: 1,
      preview_image_url: borderRow.image_url,
      metadata: {
        border_id: borderRow.border_id,
      },
    },
    ...variantRows.map((variantRow, idx) =>
      buildCardShopItem({
        id: `ragnarok_s1_variant_${idx + 1}`,
        type: "art_variant",
        row: variantRow,
        cost: 50,
      })
    ),
    {
      id: "ragnarok_s1_pack",
      type: "pack",
      name: "Card Pack",
      cost: 25,
      max_quantity: SHOP_PACK_MAX_PER_SEASON,
      description: "Standard pack for your main collection.",
      metadata: {
        quantity: 1,
      },
    },
  ];

  return shopItems;
}

async function ensureAiUser(client) {
  const { rows } = await client.query(
    `SELECT user_id FROM users WHERE user_id = $1`,
    [AI_PLAYER_ID]
  );
  if (rows.length > 0) return;

  await client.query(
    `INSERT INTO users (
       user_id, username, email, password_hash,
       in_game_currency, gold, gems, fate_coins, total_xp, pack_count,
       created_at, last_login
     ) VALUES ($1, $2, $3, $4, 0, 0, 0, 2, 0, 10, NOW(), NOW())`,
    [AI_PLAYER_ID, "AI Opponent", "ai@mythgame.com", "not_a_real_password"]
  );
  console.log("Created AI user");
}

async function ensureAiCardBack(client, backId) {
  await client.query(
    `INSERT INTO user_owned_card_backs (user_id, back_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [AI_PLAYER_ID, backId]
  );
}

async function setDeckCardBack(client, deckId, cardBackId) {
  await client.query(
    `UPDATE decks
     SET equipped_card_back_id = $2, last_updated = NOW()
     WHERE deck_id = $1`,
    [deckId, cardBackId]
  );
}

async function loadNorseVariantMap(client) {
  const { rows } = await client.query(
    `
    SELECT DISTINCT ON (ch.name)
      ch.name,
      cv.card_variant_id,
      cv.rarity
    FROM card_variants cv
    JOIN characters ch ON cv.character_id = ch.character_id
    JOIN sets s ON ch.set_id = s.set_id
    WHERE LOWER(TRIM(s.name)) = $1
    ORDER BY
      ch.name,
      CASE
        WHEN cv.rarity = 'legendary' THEN 0
        WHEN cv.rarity::text LIKE 'legendary%' THEN 1
        WHEN cv.rarity = 'epic' THEN 2
        WHEN cv.rarity = 'rare' THEN 3
        WHEN cv.rarity = 'uncommon' THEN 4
        WHEN cv.rarity = 'common' THEN 5
        ELSE 6
      END,
      cv.card_variant_id
    `,
    [NORSE_SET_NAME]
  );

  const map = new Map();
  for (const row of rows) {
    map.set(row.name, {
      card_variant_id: row.card_variant_id,
      rarity: row.rarity,
    });
  }
  return map;
}

function buildVariantLookup(variantMap) {
  const lookup = new Map();
  for (const def of DECK_DEFINITIONS) {
    for (const rawName of def.cards) {
      const name = resolveCardName(rawName);
      if (lookup.has(rawName)) continue;
      const variant = variantMap.get(name);
      if (!variant) {
        throw new Error(
          `Missing Norse card "${name}" (from deck card "${rawName}")`
        );
      }
      lookup.set(rawName, variant);
    }
  }
  return lookup;
}

async function deleteExistingSagaDecks(client) {
  const { rows: decks } = await client.query(
    `SELECT deck_id FROM decks
     WHERE user_id = $1 AND name LIKE $2`,
    [AI_PLAYER_ID, `${DECK_NAME_PREFIX}%`]
  );
  if (decks.length === 0) return 0;

  const deckIds = decks.map((d) => d.deck_id);
  await client.query(`DELETE FROM deck_cards WHERE deck_id = ANY($1::uuid[])`, [
    deckIds,
  ]);
  await client.query(`DELETE FROM decks WHERE deck_id = ANY($1::uuid[])`, [
    deckIds,
  ]);
  return deckIds.length;
}

async function findExistingDeckByName(client, name) {
  const { rows } = await client.query(
    `SELECT deck_id FROM decks WHERE user_id = $1 AND name = $2 LIMIT 1`,
    [AI_PLAYER_ID, name]
  );
  return rows[0]?.deck_id ?? null;
}

async function countDeckCards(client, deckId) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS n FROM deck_cards WHERE deck_id = $1`,
    [deckId]
  );
  return rows[0].n;
}

async function createDeckWithCards(client, def, variantLookup, cardBackId) {
  const name = deckDisplayName(def);
  let deckId = await findExistingDeckByName(client, name);

  if (deckId) {
    const count = await countDeckCards(client, deckId);
    if (count === 20) {
      await setDeckCardBack(client, deckId, cardBackId);
      console.log(`  Reusing existing deck: ${name} (${deckId})`);
      return deckId;
    }
    await client.query(`DELETE FROM deck_cards WHERE deck_id = $1`, [deckId]);
    console.log(`  Repopulating deck with wrong card count: ${name}`);
  } else {
    const inserted = await client.query(
      `INSERT INTO decks (user_id, name, equipped_card_back_id, created_at, last_updated)
       VALUES ($1, $2, $3, NOW(), NOW())
       RETURNING deck_id`,
      [AI_PLAYER_ID, name, cardBackId]
    );
    deckId = inserted.rows[0].deck_id;
    console.log(`  Created deck: ${name} (${deckId})`);
  }

  await setDeckCardBack(client, deckId, cardBackId);

  let legendaryCount = 0;
  const seenLegendaryNames = new Set();

  for (const rawName of def.cards) {
    const variant = variantLookup.get(rawName);
    if (isLegendaryRarity(variant.rarity)) {
      const resolved = resolveCardName(rawName);
      if (!seenLegendaryNames.has(resolved)) {
        seenLegendaryNames.add(resolved);
        legendaryCount += 1;
      }
    }

    for (let copy = 0; copy < 2; copy++) {
      const instance = await client.query(
        `INSERT INTO user_owned_cards (user_id, card_variant_id, level, xp, created_at)
         VALUES ($1, $2, 1, 0, NOW())
         RETURNING user_card_instance_id`,
        [AI_PLAYER_ID, variant.card_variant_id]
      );
      await client.query(
        `INSERT INTO deck_cards (deck_id, user_card_instance_id)
         VALUES ($1, $2)`,
        [deckId, instance.rows[0].user_card_instance_id]
      );
    }
  }

  if (legendaryCount > 4) {
    console.warn(
      `  Warning: ${name} has ${legendaryCount} unique legendaries (max 4 for AI)`
    );
  }

  return deckId;
}

function buildEnemyDecksPayload(deckIdsByDef) {
  const enemyDecks = {
    floor_1: [],
    floor_2: [],
    floor_3: [],
  };

  for (const def of DECK_DEFINITIONS) {
    const deckId = deckIdsByDef.get(def.id);
    enemyDecks[`floor_${def.floor}`].push(deckId);
  }

  return enemyDecks;
}

async function pickLegendaryAnchors(client, names) {
  const { rows } = await client.query(
    `
    SELECT DISTINCT ON (ch.name)
      ch.name,
      cv.card_variant_id
    FROM card_variants cv
    JOIN characters ch ON cv.character_id = ch.character_id
    JOIN sets s ON ch.set_id = s.set_id
    WHERE LOWER(TRIM(s.name)) = $1
      AND ch.name = ANY($2::text[])
      AND cv.rarity = 'legendary'
    ORDER BY ch.name, cv.card_variant_id
    `,
    [NORSE_SET_NAME, names]
  );

  return rows.map((row) => ({
    base_card_id: row.card_variant_id,
    display_name: row.name,
  }));
}

async function upsertSeason(client, enemyDecks, shopItems) {
  const anchors = await pickLegendaryAnchors(client, [
    "Odin",
    "Thor",
    "Fenrir",
  ]);

  const bossConfigs = {
    floor_1: {},
    floor_2: {},
    floor_3: {
      pre_destroyed_tiles: 3,
      worlds_end_threshold: 1,
    },
  };

  const seasonalMechanic = {
    id: "worlds_end",
    currency_name: "Echoes",
    defeats_per_destroy: 2,
  };

  const now = new Date();
  const end = new Date(now);
  end.setUTCMonth(end.getUTCMonth() + 3);

  const existing = await client.query(
    `SELECT season_id FROM saga_seasons WHERE season_id = $1`,
    [SEASON_ID]
  );

  if (existing.rows.length > 0) {
    await client.query(
      `UPDATE saga_seasons
       SET enemy_decks = $2::jsonb,
           boss_configs = $3::jsonb,
           legendary_anchors = $4::jsonb,
           seasonal_mechanic = $5::jsonb,
           shop_items = $6::jsonb,
           updated_at = NOW()
       WHERE season_id = $1`,
      [
        SEASON_ID,
        JSON.stringify(enemyDecks),
        JSON.stringify(bossConfigs),
        JSON.stringify(anchors),
        JSON.stringify(seasonalMechanic),
        JSON.stringify(shopItems),
      ]
    );
    console.log(`Updated saga season "${SEASON_ID}" (enemy_decks + configs + shop)`);
    return;
  }

  await client.query(
    `INSERT INTO saga_seasons (
       season_id, season_name, start_date, end_date,
       seasonal_mechanic, legendary_anchors, enemy_decks, boss_configs, shop_items
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb)`,
    [
      SEASON_ID,
      "Ragnar",
      now.toISOString(),
      end.toISOString(),
      JSON.stringify(seasonalMechanic),
      JSON.stringify(anchors),
      JSON.stringify(enemyDecks),
      JSON.stringify(bossConfigs),
      JSON.stringify(shopItems),
    ]
  );
  console.log(`Inserted saga season "${SEASON_ID}"`);
}

async function main() {
  const { replace, updateSeason } = parseArgs(process.argv.slice(2));

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required (set in myth-server/.env)");
    process.exit(1);
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await ensureAiUser(client);
    const norseSet = await getNorseSet(client);
    const seasonalCardBackRow = await ensureCardBack(client);
    await ensureAiCardBack(client, seasonalCardBackRow.back_id);
    const seasonalBorderRow = await ensureCardBorder(client, norseSet.set_id);
    const seasonalBossRow = await ensureSeasonBossCard(client, norseSet.set_id);
    const seasonalVariantRows = await ensureSeasonVariants(client);

    const shopItems = buildSeasonShopItems({
      bossRow: seasonalBossRow,
      cardBackRow: seasonalCardBackRow,
      borderRow: seasonalBorderRow,
      variantRows: seasonalVariantRows,
    });
    console.log(
      `Prepared seasonal shop payload (${shopItems.length} items): ` +
        `${shopItems.map((item) => item.id).join(", ")}`
    );

    const variantMap = await loadNorseVariantMap(client);
    console.log(`Loaded ${variantMap.size} Norse character variants`);

    const variantLookup = buildVariantLookup(variantMap);

    if (replace) {
      const removed = await deleteExistingSagaDecks(client);
      if (removed > 0) {
        console.log(`Removed ${removed} existing "${DECK_NAME_PREFIX}" decks`);
      }
    }

    const deckIdsByDef = new Map();
    for (const def of DECK_DEFINITIONS) {
      console.log(`Deck ${def.id} (floor ${def.floor}): ${def.name}`);
      const deckId = await createDeckWithCards(
        client,
        def,
        variantLookup,
        seasonalCardBackRow.back_id
      );
      deckIdsByDef.set(def.id, deckId);
    }

    const enemyDecks = buildEnemyDecksPayload(deckIdsByDef);

    if (updateSeason) {
      await upsertSeason(client, enemyDecks, shopItems);
    }

    await client.query("COMMIT");

    console.log("\nEnemy deck pools (paste into saga_seasons.enemy_decks):");
    console.log(JSON.stringify(enemyDecks, null, 2));

    console.log("\nDeck IDs by definition:");
    for (const def of DECK_DEFINITIONS) {
      console.log(`  ${def.id}: ${deckIdsByDef.get(def.id)}`);
    }

    console.log("\nSeasonal content IDs:");
    console.log(`  card_back_id: ${seasonalCardBackRow.back_id}`);
    console.log(`  border_id: ${seasonalBorderRow.border_id}`);
    console.log(`  boss_card_variant_id: ${seasonalBossRow.card_variant_id}`);
    console.log(
      `  variant_ids: ${seasonalVariantRows
        .map((row) => row.card_variant_id)
        .join(", ")}`
    );

    if (!updateSeason) {
      console.log(
        '\nRun with --update-season to attach pools to saga_seasons "' +
          SEASON_ID +
          '"'
      );
    }
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seed failed:", err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
