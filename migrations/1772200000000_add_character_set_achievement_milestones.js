/**
 * Seed character milestone achievements (mid/final) that reward set-tier borders:
 * - norse-mid-ach / norse-final-ach
 * - japanese-mid-ach / japanese-final-ach
 * - polynesian-mid-ach / polynesian-final-ach
 *
 * Notes:
 * - This migration is idempotent via ON CONFLICT upserts.
 * - Character resolution is by normalized character name.
 */

exports.shorthands = undefined;

const BORDER_IDS = {
  "norse-mid": "71b01cc8-9c98-4d87-9565-11fcf66f5a01",
  "norse-final": "6866ce93-c591-4cfc-a8a3-ddf5679cae1d",
  "japanese-mid": "0a7f8671-78a2-4407-bf72-375ed66813cb",
  "japanese-final": "5ef7ce74-584a-43e3-b249-ab6eb2505360",
  "polynesian-mid": "8332d6ec-c4cf-4de5-a66d-7378e13f5134",
  "polynesian-final": "7fe31f83-f088-4a2b-9079-70408f7f2215",
};

const CHARACTER_MILESTONES = [
  // Norse
  {
    lookup: "fenrir",
    display: "Fenrir",
    set: "norse",
    objective: "Destroy enemies with Devourer's Surge.",
    mid: 500,
    final: 1000,
  },
  {
    lookup: "loki",
    display: "Loki",
    set: "norse",
    objective: "Flip cards using Trickster's Gambit.",
    mid: 750,
    final: 1500,
  },
  {
    lookup: "thor",
    display: "Thor",
    set: "norse",
    objective: "Distribute 4 Dual Aspect debuffs in one turn.",
    mid: 200,
    final: 400,
  },
  {
    lookup: "jormungandr",
    display: "Jormungandr",
    set: "norse",
    objective: "Survive the end of matches without being defeated.",
    mid: 250,
    final: 500,
  },
  {
    lookup: "hel",
    display: "Hel",
    set: "norse",
    objective: "Capture the souls of 3 enemies at once.",
    mid: 200,
    final: 400,
  },
  {
    lookup: "baldr",
    display: "Baldr",
    set: "norse",
    objective: "Return to hand via Light Undimmed.",
    mid: 400,
    final: 800,
  },
  {
    lookup: "surtr",
    display: "Surtr",
    set: "norse",
    objective: "Destroy enemies with Flames of Muspelheim.",
    mid: 400,
    final: 800,
  },
  {
    lookup: "sigurd",
    display: "Sigurd",
    set: "norse",
    objective: "Play Sigurd after gaining +10 Power from Dragons.",
    mid: 100,
    final: 200,
  },
  {
    lookup: "skadi",
    display: "Skadi",
    set: "norse",
    objective: "Reduce the Power of 3 enemies at once.",
    mid: 200,
    final: 400,
  },
  {
    lookup: "vidar",
    display: "Vidar",
    set: "norse",
    objective: "Defeat the enemy that originally defeated Odin.",
    mid: 100,
    final: 200,
  },

  // Japanese
  {
    lookup: "amaterasu",
    display: "Amaterasu",
    set: "japanese",
    objective: "Grant 3 blessings in a single turn.",
    mid: 100,
    final: 200,
  },
  {
    lookup: "ryujin",
    display: "Ryujin",
    set: "japanese",
    objective: "Defeat 2 enemies diagonally in a single turn.",
    mid: 200,
    final: 400,
  },
  {
    lookup: "tsukuyomi",
    display: "Tsukuyomi",
    set: "japanese",
    objective: "Siphon Power from an enemy that has 15+ Power.",
    mid: 100,
    final: 200,
  },
  {
    lookup: "susanoo",
    display: "Susanoo",
    set: "japanese",
    objective: "Destroy BEAST or DRAGON cards.",
    mid: 150,
    final: 300,
  },
  {
    lookup: "hachiman",
    display: "Hachiman",
    set: "japanese",
    objective: "Buff a full row of allies.",
    mid: 300,
    final: 600,
  },
  {
    lookup: "yamabiko",
    display: "Yamabiko",
    set: "japanese",
    objective: "Copy the power of an enemy that has 15+ Power.",
    mid: 100,
    final: 200,
  },
  {
    lookup: "benkei",
    display: "Benkei",
    set: "japanese",
    objective: "Gain +4 Power from a single Battlecry play.",
    mid: 100,
    final: 200,
  },
  {
    lookup: "futakuchionna",
    display: "Futakuchi-onna",
    set: "japanese",
    objective: "Reduce the power of 4 adjacent enemies at once.",
    mid: 200,
    final: 400,
  },
  {
    lookup: "yukionna",
    display: "Yuki-onna",
    set: "japanese",
    objective: "Affect 3 enemies in a single row with one play.",
    mid: 100,
    final: 200,
  },
  {
    lookup: "minamoto",
    display: "Minamoto",
    set: "japanese",
    objective: "Play Minamoto with +10 Power.",
    mid: 200,
    final: 400,
  },
  {
    lookup: "nurarihyon",
    display: "Nurarihyon",
    set: "japanese",
    objective: "Steal blessings from enemies.",
    mid: 400,
    final: 800,
  },
  {
    lookup: "jorogumo",
    display: "Jorogumo",
    set: "japanese",
    objective: "Curse enemies.",
    mid: 1000,
    final: 2000,
  },
  {
    lookup: "kintaro",
    display: "Kintaro",
    set: "japanese",
    objective: "Gain +6 Power in a single Battlecry.",
    mid: 200,
    final: 400,
  },
  {
    lookup: "yamatanoorochi",
    display: "Yamata-no-Orochi",
    set: "japanese",
    objective: "Affect 5 different enemies with a single Battlecry.",
    mid: 100,
    final: 200,
  },

  // Polynesian
  {
    lookup: "pele",
    display: "Pele",
    set: "polynesian",
    objective: "Reach +5 power from Lava Field.",
    mid: 200,
    final: 400,
  },
  {
    lookup: "maui",
    display: "Maui",
    set: "polynesian",
    objective: "Play Maui with 5 stacks of Sun Trick or higher.",
    mid: 200,
    final: 400,
  },
  {
    lookup: "kane",
    display: "Kane",
    set: "polynesian",
    objective: "Protect 2 allies from defeat in a single turn.",
    mid: 100,
    final: 200,
  },
  {
    lookup: "nightmarchers",
    display: "Nightmarchers",
    set: "polynesian",
    objective: "Successfully move and curse 4 tiles in one match.",
    mid: 100,
    final: 200,
  },
  {
    lookup: "kamapuaa",
    display: "Kamapua'a",
    set: "polynesian",
    objective: "Have 5 Lava tiles active on the board at the same time.",
    mid: 100,
    final: 200,
  },
  {
    lookup: "kaahupahau",
    display: "Ka'ahupahau",
    set: "polynesian",
    objective: "Save an ally.",
    mid: 1000,
    final: 2000,
  },
  {
    lookup: "ku",
    display: "Ku",
    set: "polynesian",
    objective: "Defeat 2 or more enemies with Blood Altar.",
    mid: 200,
    final: 400,
  },
  {
    lookup: "milu",
    display: "Milu",
    set: "polynesian",
    objective: "Drain an attacker that has 12+ Power.",
    mid: 200,
    final: 400,
  },
  {
    lookup: "ukupa",
    display: "Ukupa",
    set: "polynesian",
    objective: "Turn 4 tiles into water in a single match.",
    mid: 100,
    final: 200,
  },
  {
    lookup: "laamaomao",
    display: "La'amaomao",
    set: "polynesian",
    objective: "Push 2 enemies away in a single turn.",
    mid: 200,
    final: 400,
  },
  {
    lookup: "kupua",
    display: "Kupua",
    set: "polynesian",
    objective: "Reduce the power of 5 enemies at once.",
    mid: 200,
    final: 400,
  },
  {
    lookup: "kanehekili",
    display: "Kanehekili",
    set: "polynesian",
    objective: "Reduce the same enemy's power 3 times in one match.",
    mid: 200,
    final: 400,
  },
  {
    lookup: "kamohoalii",
    display: "Kamohoali'i",
    set: "polynesian",
    objective: "Defeat a stronger enemy.",
    mid: 400,
    final: 800,
  },
];

function escapeSql(value) {
  return value.replace(/'/g, "''");
}

function normalizedNameSql(columnName) {
  return `regexp_replace(translate(lower(${columnName}), 'āēīōūö', 'aeiouo'), '[^a-z0-9]+', '', 'g')`;
}

function buildCharacterValuesSql() {
  return CHARACTER_MILESTONES.map(
    (m) =>
      `('${escapeSql(m.lookup)}', '${escapeSql(m.display)}', '${escapeSql(
        m.set
      )}', '${escapeSql(m.objective)}', ${m.mid}, ${m.final})`
  ).join(",\n      ");
}

exports.up = (pgm) => {
  const characterValuesSql = buildCharacterValuesSql();

  pgm.sql(`
    DO $$
    DECLARE
      missing_characters text;
      matched_character_count integer;
      total_character_count integer;
    BEGIN
      WITH character_mappings (
        lookup_key, display_name, set_slug, objective_text, mid_target, final_target
      ) AS (
        VALUES
          ${characterValuesSql}
      ),
      resolved AS (
        SELECT
          cm.lookup_key
        FROM character_mappings cm
        JOIN characters ch
          ON (
            ${normalizedNameSql("ch.name")} = cm.lookup_key OR
            (cm.lookup_key = 'minamoto' AND ${normalizedNameSql("ch.name")} LIKE 'minamoto%') OR
            (cm.lookup_key = 'ukupa' AND ${normalizedNameSql("ch.name")} LIKE 'ukupa%')
          )
      )
      SELECT
        (
          SELECT string_agg(cm.display_name, ', ')
          FROM character_mappings cm
          LEFT JOIN resolved r ON r.lookup_key = cm.lookup_key
          WHERE r.lookup_key IS NULL
        ),
        (SELECT COUNT(*) FROM resolved),
        (SELECT COUNT(*) FROM character_mappings)
      INTO
        missing_characters,
        matched_character_count,
        total_character_count;

      IF matched_character_count = 0 THEN
        RAISE NOTICE
          'Skipping character achievement migration seed because no characters were resolved.';
      ELSIF missing_characters IS NOT NULL THEN
        RAISE EXCEPTION
          'Character achievement migration failed. Missing characters: %',
          missing_characters;
      END IF;
    END
    $$;
  `);

  pgm.sql(`
    WITH character_mappings (
      lookup_key, display_name, set_slug, objective_text, mid_target, final_target
    ) AS (
      VALUES
        ${characterValuesSql}
    ),
    resolved_characters AS (
      SELECT
        cm.lookup_key,
        cm.display_name,
        cm.set_slug,
        cm.objective_text,
        cm.mid_target,
        cm.final_target,
        ch.character_id,
        ch.set_id
      FROM character_mappings cm
      JOIN characters ch
        ON (
          ${normalizedNameSql("ch.name")} = cm.lookup_key OR
          (cm.lookup_key = 'minamoto' AND ${normalizedNameSql("ch.name")} LIKE 'minamoto%') OR
          (cm.lookup_key = 'ukupa' AND ${normalizedNameSql("ch.name")} LIKE 'ukupa%')
        )
    ),
    set_ids AS (
      SELECT DISTINCT ON (set_slug)
        set_slug,
        set_id
      FROM resolved_characters
      WHERE set_id IS NOT NULL
      ORDER BY set_slug, set_id::text
    ),
    border_defs AS (
      SELECT * FROM (VALUES
        ('${BORDER_IDS["norse-mid"]}'::uuid, 'norse-mid-ach', 'norse', 'mid'),
        ('${BORDER_IDS["norse-final"]}'::uuid, 'norse-final-ach', 'norse', 'final'),
        ('${BORDER_IDS["japanese-mid"]}'::uuid, 'japanese-mid-ach', 'japanese', 'mid'),
        ('${BORDER_IDS["japanese-final"]}'::uuid, 'japanese-final-ach', 'japanese', 'final'),
        ('${BORDER_IDS["polynesian-mid"]}'::uuid, 'polynesian-mid-ach', 'polynesian', 'mid'),
        ('${BORDER_IDS["polynesian-final"]}'::uuid, 'polynesian-final-ach', 'polynesian', 'final')
      ) AS b(border_id, border_name, set_slug, tier_slug)
    ),
    upsert_borders AS (
      INSERT INTO card_borders (
        border_id, name, description, image_url, animation_key,
        character_id, set_id, is_active
      )
      SELECT
        bd.border_id,
        bd.border_name,
        'Achievement border for ' || bd.set_slug || ' (' || bd.tier_slug || ' tier).',
        'https://assets.myth-server/borders/' || bd.border_name || '.png',
        NULL,
        NULL,
        s.set_id,
        true
      FROM border_defs bd
      JOIN set_ids s ON s.set_slug = bd.set_slug
      ON CONFLICT (border_id) DO UPDATE
        SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          image_url = EXCLUDED.image_url,
          animation_key = EXCLUDED.animation_key,
          character_id = EXCLUDED.character_id,
          set_id = EXCLUDED.set_id,
          is_active = true,
          updated_at = NOW()
      RETURNING border_id
    ),
    tier_rows AS (
      SELECT
        rc.lookup_key,
        rc.display_name,
        rc.set_slug,
        rc.objective_text,
        rc.character_id,
        1 AS tier_level,
        rc.mid_target AS target_value,
        'mid'::text AS tier_slug
      FROM resolved_characters rc
      UNION ALL
      SELECT
        rc.lookup_key,
        rc.display_name,
        rc.set_slug,
        rc.objective_text,
        rc.character_id,
        2 AS tier_level,
        rc.final_target AS target_value,
        'final'::text AS tier_slug
      FROM resolved_characters rc
    ),
    tier_rows_ordered AS (
      SELECT
        tr.*,
        ROW_NUMBER() OVER (
          ORDER BY tr.set_slug, tr.lookup_key, tr.tier_level
        ) AS rn
      FROM tier_rows tr
    ),
    tier_border_map AS (
      SELECT * FROM (VALUES
        ('norse', 'mid', '${BORDER_IDS["norse-mid"]}'::uuid),
        ('norse', 'final', '${BORDER_IDS["norse-final"]}'::uuid),
        ('japanese', 'mid', '${BORDER_IDS["japanese-mid"]}'::uuid),
        ('japanese', 'final', '${BORDER_IDS["japanese-final"]}'::uuid),
        ('polynesian', 'mid', '${BORDER_IDS["polynesian-mid"]}'::uuid),
        ('polynesian', 'final', '${BORDER_IDS["polynesian-final"]}'::uuid)
      ) AS m(set_slug, tier_slug, border_id)
    )
    INSERT INTO achievements (
      achievement_key,
      title,
      description,
      achievement_kind,
      character_id,
      category,
      type,
      target_value,
      rarity,
      reward_gems,
      reward_packs,
      reward_fate_coins,
      reward_card_fragments,
      reward_border_id,
      icon_url,
      is_active,
      sort_order,
      base_achievement_key,
      tier_level
    )
    SELECT
      'char_' || tro.lookup_key || '_' || tro.tier_slug || '_ach' AS achievement_key,
      tro.display_name || ' Mastery ' || CASE WHEN tro.tier_level = 1 THEN 'I' ELSE 'II' END AS title,
      tro.objective_text || ' (' || tro.target_value || ' times)' AS description,
      'character',
      tro.character_id,
      'gameplay',
      'progress',
      tro.target_value,
      CASE WHEN tro.tier_level = 1 THEN 'epic' ELSE 'legendary' END,
      0,
      0,
      0,
      0,
      tbm.border_id,
      NULL,
      true,
      4000 + tro.rn,
      'char_' || tro.lookup_key || '_ach',
      tro.tier_level
    FROM tier_rows_ordered tro
    JOIN tier_border_map tbm
      ON tbm.set_slug = tro.set_slug
     AND tbm.tier_slug = tro.tier_slug
    ON CONFLICT (achievement_key) DO UPDATE
      SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        achievement_kind = EXCLUDED.achievement_kind,
        character_id = EXCLUDED.character_id,
        category = EXCLUDED.category,
        type = EXCLUDED.type,
        target_value = EXCLUDED.target_value,
        rarity = EXCLUDED.rarity,
        reward_gems = EXCLUDED.reward_gems,
        reward_packs = EXCLUDED.reward_packs,
        reward_fate_coins = EXCLUDED.reward_fate_coins,
        reward_card_fragments = EXCLUDED.reward_card_fragments,
        reward_border_id = EXCLUDED.reward_border_id,
        icon_url = EXCLUDED.icon_url,
        is_active = EXCLUDED.is_active,
        sort_order = EXCLUDED.sort_order,
        base_achievement_key = EXCLUDED.base_achievement_key,
        tier_level = EXCLUDED.tier_level,
        updated_at = NOW();
  `);
};

exports.down = (pgm) => {
  const achievementKeysSql = CHARACTER_MILESTONES.flatMap((m) => [
    `'char_${escapeSql(m.lookup)}_mid_ach'`,
    `'char_${escapeSql(m.lookup)}_final_ach'`,
  ]).join(",\n      ");

  pgm.sql(`
    DELETE FROM achievements
    WHERE achievement_key IN (
      ${achievementKeysSql}
    );
  `);

  pgm.sql(`
    DELETE FROM card_borders
    WHERE border_id IN (
      '${BORDER_IDS["norse-mid"]}'::uuid,
      '${BORDER_IDS["norse-final"]}'::uuid,
      '${BORDER_IDS["japanese-mid"]}'::uuid,
      '${BORDER_IDS["japanese-final"]}'::uuid,
      '${BORDER_IDS["polynesian-mid"]}'::uuid,
      '${BORDER_IDS["polynesian-final"]}'::uuid
    );
  `);
};

