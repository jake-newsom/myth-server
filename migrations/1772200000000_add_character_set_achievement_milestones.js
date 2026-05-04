/**
 * Seed character milestone achievements (mid/final).
 *
 * Reward structure:
 * - Mid tier (per character) rewards a SET-wide border named
 *   "{set}-final-ach" (3 total: norse-final-ach, japanese-final-ach,
 *   polynesian-final-ach). Earning the mid tier on any character in a set
 *   awards that set's shared border.
 * - Final tier (per character) rewards a CHARACTER-specific border
 *   (one per character; 37 total).
 *
 * Total borders managed by this migration: 40 (3 set + 37 character).
 *
 * Notes:
 * - This migration is idempotent via ON CONFLICT upserts.
 * - Character resolution is by normalized character name.
 * - Image filenames for character borders are placeholders (lookup + "-ach.webp");
 *   replace `borderFile` per character as final art lands.
 */

exports.shorthands = undefined;

// Set-tier borders awarded for the MID achievement tier of each character.
const SET_BORDER_IDS = {
  norse: "6866ce93-c591-4cfc-a8a3-ddf5679cae1d",
  japanese: "5ef7ce74-584a-43e3-b249-ab6eb2505360",
  polynesian: "7fe31f83-f088-4a2b-9079-70408f7f2215",
};

// Legacy "{set}-mid-ach" border IDs created by the previous version of this
// migration. Kept here so down() can clean them up if a DB still has them.
// Safe to keep indefinitely; DELETE is a no-op if the rows are absent.
const LEGACY_MID_BORDER_IDS = {
  norse: "71b01cc8-9c98-4d87-9565-11fcf66f5a01",
  japanese: "0a7f8671-78a2-4407-bf72-375ed66813cb",
  polynesian: "8332d6ec-c4cf-4de5-a66d-7378e13f5134",
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
    borderId: "d4c6a91e-8b3f-4a2c-9d5e-7f8a1b2c3d01",
    borderFile: "fenrir-ach.webp",
  },
  {
    lookup: "loki",
    display: "Loki",
    set: "norse",
    objective: "Flip cards using Trickster's Gambit.",
    mid: 750,
    final: 1500,
    borderId: "e5d7ba2f-9c4a-4b3d-ae6f-8a9b2c3d4e02",
    borderFile: "loki-ach.webp",
  },
  {
    lookup: "thor",
    display: "Thor",
    set: "norse",
    objective: "Reduce the power of 5 enemies at once.",
    mid: 200,
    final: 400,
    borderId: "f6e8cb30-ad5b-4c4e-bf70-9bac3d4e5f03",
    borderFile: "thor-ach.webp",
  },
  {
    lookup: "jormungandr",
    display: "Jormungandr",
    set: "norse",
    objective: "Survive match end without being defeated.",
    mid: 250,
    final: 500,
    borderId: "17f9dc41-be6c-4d5f-a081-acbd4e5f6a04",
    borderFile: "jormungandr-ach.webp",
  },
  {
    lookup: "hel",
    display: "Hel",
    set: "norse",
    objective: "Capture the souls of 3 enemies at once.",
    mid: 200,
    final: 400,
    borderId: "280aed52-cf7d-4e60-b192-bdce5f6a7b05",
    borderFile: "hel-ach.webp",
  },
  {
    lookup: "baldr",
    display: "Baldr",
    set: "norse",
    objective: "Return to hand via Mistletainn's Absence.",
    mid: 400,
    final: 800,
    borderId: "391bfe63-d08e-4f71-a2a3-cedf6a7b8c06",
    borderFile: "baldr-ach.webp",
  },
  {
    lookup: "surtr",
    display: "Surtr",
    set: "norse",
    objective: "Destroy enemies with Flames of Muspelheim.",
    mid: 400,
    final: 800,
    borderId: "4a2c0f74-e19f-4082-b3b4-dfea7b8c9d07",
    borderFile: "surtr-ach.webp",
  },
  {
    lookup: "sigurd",
    display: "Sigurd",
    set: "norse",
    objective: "Gain +10 Power from Gram's Edge before play.",
    mid: 100,
    final: 200,
    borderId: "5b3d1085-f2a0-4193-a4c5-eafb8c9d0e08",
    borderFile: "sigurd-ach.webp",
  },
  {
    lookup: "skadi",
    display: "Skadi",
    set: "norse",
    objective: "Reduce the Power of 3 enemies at once with Winter's Step.",
    mid: 200,
    final: 400,
    borderId: "6c4e2196-03b1-42a4-b5d6-fbac9d0e1f09",
    borderFile: "skadi-ach.webp",
  },
  {
    lookup: "vidar",
    display: "Vidar",
    set: "norse",
    objective: "Defeat the enemy that originally defeated Odin.",
    mid: 100,
    final: 200,
    borderId: "7d5f32a7-14c2-43b5-a6e7-acbd0e1f2a0a",
    borderFile: "vidar-ach.webp",
  },

  // Japanese
  {
    lookup: "amaterasu",
    display: "Amaterasu",
    set: "japanese",
    objective: "Grant 3 blessings in a single turn with Cave's Light.",
    mid: 100,
    final: 200,
    borderId: "8e6043b8-25d3-44c6-b7f8-bdce1f2a3b0b",
    borderFile: "amaterasu-ach.webp",
  },
  {
    lookup: "ryujin",
    display: "Ryujin",
    set: "japanese",
    objective: "Defeat 2 enemies diagonally in a single turn with Tide Jewel Pulse.",
    mid: 200,
    final: 400,
    borderId: "9f7154c9-36e4-45d7-a809-cedf2a3b4c0c",
    borderFile: "ryujin-ach.webp",
  },
  {
    lookup: "tsukuyomi",
    display: "Tsukuyomi",
    set: "japanese",
    objective: "Siphon Power from an enemy with 15+ Power on one side.",
    mid: 100,
    final: 200,
    borderId: "a08265da-47f5-46e8-b91a-dfea3b4c5d0d",
    borderFile: "tsukuyomi-ach.webp",
  },
  {
    lookup: "susanoo",
    display: "Susanoo",
    set: "japanese",
    objective: "Destroy a BEAST or DRAGON card with Kusanagi's Strike.",
    mid: 150,
    final: 300,
    borderId: "b19376eb-58a6-47f9-a02b-eafb4c5d6e0e",
    borderFile: "susanoo-ach.webp",
  },
  {
    lookup: "hachiman",
    display: "Hachiman",
    set: "japanese",
    objective: "Buff a full row of allies with Divine Archery.",
    mid: 300,
    final: 600,
    borderId: "c2a487fc-69b7-4801-b13c-fbac5d6e7f0f",
    borderFile: "hachiman-ach.webp",
  },
  {
    lookup: "yamabiko",
    display: "Yamabiko",
    set: "japanese",
    objective: "Defeat the enemy you copied with Mountain's Mimicry.",
    mid: 100,
    final: 200,
    borderId: "d3b5980d-7ac8-4912-a24d-acbd6e7f8a10",
    borderFile: "yamabiko-ach.webp",
  },
  {
    lookup: "benkei",
    display: "Benkei",
    set: "japanese",
    objective: "Gain +4 Power from Standing Death.",
    mid: 100,
    final: 200,
    borderId: "e4c6a91e-8bd9-4a23-b35e-bdce7f8a9b11",
    borderFile: "benkei-ach.webp",
  },
  {
    lookup: "futakuchionna",
    display: "Futakuchi-onna",
    set: "japanese",
    objective: "Reduce power of 4 adjacent enemies at once.",
    mid: 200,
    final: 400,
    borderId: "f5d7ba2f-9cea-4b34-a46f-cedf8a9bac12",
    borderFile: "futakuchi-ach.webp",
  },
  {
    lookup: "yukionna",
    display: "Yuki-onna",
    set: "japanese",
    objective: "Affect 3 enemies at once with Frozen Breath.",
    mid: 100,
    final: 200,
    borderId: "06e8cb30-adfb-4c45-b570-dfea9bacbd13",
    borderFile: "yukionna-ach.webp",
  },
  {
    lookup: "minamoto",
    display: "Minamoto",
    set: "japanese",
    objective: "Play Minamoto with +10 power from Demon Bane.",
    mid: 200,
    final: 400,
    borderId: "17f9dc41-be0c-4d56-a681-eafbacbdce14",
    borderFile: "minamoto-ach.webp",
  },
  {
    lookup: "nurarihyon",
    display: "Nurarihyon",
    set: "japanese",
    objective: "Steal blessings from enemies with Supreme Commander.",
    mid: 400,
    final: 800,
    borderId: "280aed52-cf1d-4e67-b792-fbacbdcedf15",
    borderFile: "nurarihyon-ach.webp",
  },
  {
    lookup: "jorogumo",
    display: "Jorogumo",
    set: "japanese",
    objective: "Curse enemies with Web Curse.",
    mid: 1000,
    final: 2000,
    borderId: "391bfe63-d02e-4f78-a8a3-acbdcedfea16",
    borderFile: "jorogumo-ach.webp",
  },
  {
    lookup: "kintaro",
    display: "Kintaro",
    set: "japanese",
    objective: "Gain +6 Power with Golden Boy's Grip.",
    mid: 200,
    final: 400,
    borderId: "4a2c0f74-e13f-4089-b9b4-bdcedfeafb17",
    borderFile: "kintaro-ach.webp",
  },
  {
    lookup: "yamatanoorochi",
    display: "Yamata-no-Orochi",
    set: "japanese",
    objective: "Affect 5 different enemies with a single Eight-Fold Venom.",
    mid: 100,
    final: 200,
    borderId: "5b3d1085-f240-419a-a0c5-cedfeafbac18",
    borderFile: "orochi-ach.webp",
  },

  // Polynesian
  {
    lookup: "pele",
    display: "Pele",
    set: "polynesian",
    objective: "Reach +5 power from Lava Field.",
    mid: 200,
    final: 400,
    borderId: "6c4e2196-0351-42ab-b1d6-dfeafbacbd19",
    borderFile: "pele-ach.webp",
  },
  {
    lookup: "maui",
    display: "Maui",
    set: "polynesian",
    objective: "Play Maui with 5 stacks of Sun Trick or higher.",
    mid: 200,
    final: 400,
    borderId: "7d5f32a7-1462-43bc-a2e7-eafbacbdce1a",
    borderFile: "maui-ach.webp",
  },
  {
    lookup: "kane",
    display: "Kane",
    set: "polynesian",
    objective: "Protect 2 allies from defeat in a single turn with Wai-Ola.",
    mid: 100,
    final: 200,
    borderId: "8e6043b8-2573-44cd-b3f8-fbacbdcedf1b",
    borderFile: "kane-ach.webp",
  },
  {
    lookup: "nightmarchers",
    display: "Nightmarchers",
    set: "polynesian",
    objective: "Successfully move and curse 4 tiles in one match.",
    mid: 100,
    final: 200,
    borderId: "9f7154c9-3684-45de-a409-acbdcedfea1c",
    borderFile: "nightmarchers-ach.webp",
  },
  {
    lookup: "kamapuaa",
    display: "Kamapua'a",
    set: "polynesian",
    objective: "Have 4 Lava tiles active at the same time.",
    mid: 100,
    final: 200,
    borderId: "a08265da-4795-46ef-b51a-bdcedfeafb1d",
    borderFile: "kamapuaa-ach.webp",
  },
  {
    lookup: "kaahupahau",
    display: "Ka'ahupahau",
    set: "polynesian",
    objective: "Protect an ally with Pu'uloa Guard.",
    mid: 1000,
    final: 2000,
    borderId: "b19376eb-58a6-4801-a62b-cedfeafbac1e",
    borderFile: "kaahupahau-ach.webp",
  },
  {
    lookup: "ku",
    display: "Ku",
    set: "polynesian",
    objective: "Defeat 2 or more enemies with Blood Altar.",
    mid: 200,
    final: 400,
    borderId: "c2a487fc-69b7-4912-b73c-dfeafbacbd1f",
    borderFile: "ku-ach.webp",
  },
  {
    lookup: "milu",
    display: "Milu",
    set: "polynesian",
    objective: "Drain an attacker that has 12+ Power with Spirit Bind.",
    mid: 200,
    final: 400,
    borderId: "d3b5980d-7ac8-4a23-a84d-eafbacbdce20",
    borderFile: "milu-ach.webp",
  },
  {
    lookup: "ukupa",
    display: "Ukupa",
    set: "polynesian",
    objective: "Turn 4 tiles into water in a single match with Shark God's Wake.",
    mid: 100,
    final: 200,
    borderId: "e4c6a91e-8bd9-4b34-b95e-fbacbdcedf21",
    borderFile: "ukupanipo-ach.webp",
  },
  {
    lookup: "laamaomao",
    display: "La'amaomao",
    set: "polynesian",
    objective: "Push 2 enemies away in a single turn.",
    mid: 200,
    final: 400,
    borderId: "f5d7ba2f-9cea-4c45-aa6f-acbdcedfea22",
    borderFile: "laamaomao-ach.webp",
  },
  {
    lookup: "kupua",
    display: "Kupua",
    set: "polynesian",
    objective: "Distribute 4 Dual Aspect debuffs in one turn.",
    mid: 200,
    final: 400,
    borderId: "06e8cb30-adfb-4d56-bb70-bdcedfeafb23",
    borderFile: "kupua-ach.webp",
  },
  {
    lookup: "kanehekili",
    display: "Kanehekili",
    set: "polynesian",
    objective: "Reduce same enemy's power 3 times in one match with Split Sky.",
    mid: 200,
    final: 400,
    borderId: "17f9dc41-be0c-4e67-ac81-cedfeafbac24",
    borderFile: "kanehekili-ach.webp",
  },
  {
    lookup: "kamohoalii",
    display: "Kamohoali'i",
    set: "polynesian",
    objective: "Defeat a stronger enemy.",
    mid: 400,
    final: 800,
    borderId: "280aed52-cf1d-4f78-bd92-dfeafbacbd25",
    borderFile: "kamohoalii-ach.webp",
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
      )}', '${escapeSql(m.objective)}', ${m.mid}, ${m.final}, '${
        m.borderId
      }'::uuid, '${escapeSql(m.borderFile)}')`
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
        lookup_key, display_name, set_slug, objective_text,
        mid_target, final_target, character_border_id, character_border_file
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

  // Upsert all 40 borders (3 set + 37 character) BEFORE inserting achievements
  // so that the reward_border_id FK is satisfied when the achievement rows land.
  pgm.sql(`
    WITH character_mappings (
      lookup_key, display_name, set_slug, objective_text,
      mid_target, final_target, character_border_id, character_border_file
    ) AS (
      VALUES
        ${characterValuesSql}
    ),
    resolved_characters AS (
      SELECT
        cm.lookup_key,
        cm.display_name,
        cm.set_slug,
        cm.character_border_id,
        cm.character_border_file,
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
    set_border_defs AS (
      SELECT * FROM (VALUES
        ('${SET_BORDER_IDS.norse}'::uuid, 'norse-final-ach', 'norse'),
        ('${SET_BORDER_IDS.japanese}'::uuid, 'japanese-final-ach', 'japanese'),
        ('${SET_BORDER_IDS.polynesian}'::uuid, 'polynesian-final-ach', 'polynesian')
      ) AS b(border_id, border_name, set_slug)
    ),
    upsert_set_borders AS (
      INSERT INTO card_borders (
        border_id, name, description, image_url, animation_key,
        character_id, set_id, is_active
      )
      SELECT
        sbd.border_id,
        sbd.border_name,
        'Set achievement border for ' || sbd.set_slug || ' (mid-tier reward).',
        '/borders/' || sbd.border_name || '-ach.webp',
        NULL,
        NULL,
        s.set_id,
        true
      FROM set_border_defs sbd
      JOIN set_ids s ON s.set_slug = sbd.set_slug
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
    )
    INSERT INTO card_borders (
      border_id, name, description, image_url, animation_key,
      character_id, set_id, is_active
    )
    SELECT
      rc.character_border_id,
      rc.lookup_key || '-final-ach',
      'Character achievement border for ' || rc.display_name || ' (final-tier reward).',
      '/borders/' || rc.character_border_file,
      NULL,
      rc.character_id,
      rc.set_id,
      true
    FROM resolved_characters rc
    WHERE (SELECT COUNT(*) FROM upsert_set_borders) >= 0
    ON CONFLICT (border_id) DO UPDATE
      SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        image_url = EXCLUDED.image_url,
        animation_key = EXCLUDED.animation_key,
        character_id = EXCLUDED.character_id,
        set_id = EXCLUDED.set_id,
        is_active = true,
        updated_at = NOW();
  `);

  // Insert achievements. Mid tier rewards the set-wide border;
  // final tier rewards the character-specific border.
  pgm.sql(`
    WITH character_mappings (
      lookup_key, display_name, set_slug, objective_text,
      mid_target, final_target, character_border_id, character_border_file
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
        cm.character_border_id,
        ch.character_id
      FROM character_mappings cm
      JOIN characters ch
        ON (
          ${normalizedNameSql("ch.name")} = cm.lookup_key OR
          (cm.lookup_key = 'minamoto' AND ${normalizedNameSql("ch.name")} LIKE 'minamoto%') OR
          (cm.lookup_key = 'ukupa' AND ${normalizedNameSql("ch.name")} LIKE 'ukupa%')
        )
    ),
    set_border_map AS (
      SELECT * FROM (VALUES
        ('norse', '${SET_BORDER_IDS.norse}'::uuid),
        ('japanese', '${SET_BORDER_IDS.japanese}'::uuid),
        ('polynesian', '${SET_BORDER_IDS.polynesian}'::uuid)
      ) AS m(set_slug, border_id)
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
        'mid'::text AS tier_slug,
        sbm.border_id AS reward_border_id
      FROM resolved_characters rc
      JOIN set_border_map sbm ON sbm.set_slug = rc.set_slug
      UNION ALL
      SELECT
        rc.lookup_key,
        rc.display_name,
        rc.set_slug,
        rc.objective_text,
        rc.character_id,
        2 AS tier_level,
        rc.final_target AS target_value,
        'final'::text AS tier_slug,
        rc.character_border_id AS reward_border_id
      FROM resolved_characters rc
    ),
    tier_rows_ordered AS (
      SELECT
        tr.*,
        ROW_NUMBER() OVER (
          ORDER BY tr.set_slug, tr.lookup_key, tr.tier_level
        ) AS rn
      FROM tier_rows tr
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
      tro.reward_border_id,
      NULL,
      true,
      4000 + tro.rn,
      'char_' || tro.lookup_key || '_ach',
      tro.tier_level
    FROM tier_rows_ordered tro
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

  const characterBorderIdsSql = CHARACTER_MILESTONES.map(
    (m) => `'${m.borderId}'::uuid`
  ).join(",\n      ");

  pgm.sql(`
    DELETE FROM achievements
    WHERE achievement_key IN (
      ${achievementKeysSql}
    );
  `);

  pgm.sql(`
    DELETE FROM card_borders
    WHERE border_id IN (
      '${SET_BORDER_IDS.norse}'::uuid,
      '${SET_BORDER_IDS.japanese}'::uuid,
      '${SET_BORDER_IDS.polynesian}'::uuid,
      '${LEGACY_MID_BORDER_IDS.norse}'::uuid,
      '${LEGACY_MID_BORDER_IDS.japanese}'::uuid,
      '${LEGACY_MID_BORDER_IDS.polynesian}'::uuid,
      ${characterBorderIdsSql}
    );
  `);
};
