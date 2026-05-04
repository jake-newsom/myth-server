/**
 * Seed three "collect the set" standard achievements.
 *
 * Each achievement:
 *   - Tracks how many distinct characters in a single set the user owns at
 *     least one copy of.
 *   - Completes when the user has collected one of every character in the set
 *     (currently 30 per set).
 *   - Rewards the corresponding `{set}-mid-ach` border + 500 gems.
 *
 * The three sets are pinned to their existing border IDs (originally created
 * by the legacy version of `1772200000000_add_character_set_achievement_milestones`
 * and intentionally retained in the schema for this purpose).
 *
 * The achievement reward border is restricted to the matching set in
 * `card_borders.set_id`, so awarding it via the standard achievement claim
 * flow correctly grants per-character ownership across the entire set.
 *
 * Idempotent via ON CONFLICT upserts on both achievements and borders.
 */

exports.shorthands = undefined;

const SET_COLLECTION_ACHIEVEMENTS = [
  {
    achievement_key: "collect_norse_set",
    set_slug: "norse",
    set_display: "Norse",
    border_id: "71b01cc8-9c98-4d87-9565-11fcf66f5a01",
    border_name: "norse-mid-ach",
    sort_order: 3990,
  },
  {
    achievement_key: "collect_japanese_set",
    set_slug: "japanese",
    set_display: "Japanese",
    border_id: "0a7f8671-78a2-4407-bf72-375ed66813cb",
    border_name: "japanese-mid-ach",
    sort_order: 3991,
  },
  {
    achievement_key: "collect_polynesian_set",
    set_slug: "polynesian",
    set_display: "Polynesian",
    border_id: "8332d6ec-c4cf-4de5-a66d-7378e13f5134",
    border_name: "polynesian-mid-ach",
    sort_order: 3992,
  },
];

const TARGET_PER_SET = 30;
const REWARD_GEMS = 500;

function escapeSql(value) {
  return value.replace(/'/g, "''");
}

function buildSetBorderValuesSql() {
  return SET_COLLECTION_ACHIEVEMENTS.map(
    (a) =>
      `('${a.border_id}'::uuid, '${escapeSql(a.border_name)}', '${escapeSql(
        a.set_slug
      )}', '${escapeSql(a.set_display)}')`
  ).join(",\n      ");
}

function buildAchievementValuesSql() {
  return SET_COLLECTION_ACHIEVEMENTS.map((a) => {
    const description = `Collect at least one copy of each character in the ${a.set_display} set.`;
    const title = `${a.set_display} Collector`;
    return `(
      '${escapeSql(a.achievement_key)}',
      '${escapeSql(title)}',
      '${escapeSql(description)}',
      '${a.border_id}'::uuid,
      ${a.sort_order}
    )`;
  }).join(",\n      ");
}

exports.up = (pgm) => {
  // Re-affirm the three set-tier mid borders. They already exist on local
  // databases (created by the early version of the milestone seed migration),
  // but on a fresh prod database they need to be present before the
  // achievement insert below can satisfy its FK on reward_border_id.
  pgm.sql(`
    WITH border_seed (border_id, border_name, set_slug, set_display) AS (
      VALUES
        ${buildSetBorderValuesSql()}
    ),
    set_lookup AS (
      SELECT lower(s.name) AS set_slug, s.set_id
      FROM sets s
      WHERE lower(s.name) IN ('norse', 'japanese', 'polynesian')
    )
    INSERT INTO card_borders (
      border_id,
      name,
      description,
      image_url,
      animation_key,
      character_id,
      set_id,
      is_active
    )
    SELECT
      bs.border_id,
      bs.border_name,
      'Awarded for collecting one of every character in the ' || bs.set_display || ' set.',
      '/borders/' || bs.border_name || '.webp',
      NULL,
      NULL,
      sl.set_id,
      true
    FROM border_seed bs
    JOIN set_lookup sl ON sl.set_slug = bs.set_slug
    ON CONFLICT (border_id) DO UPDATE
      SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        image_url = EXCLUDED.image_url,
        set_id = EXCLUDED.set_id,
        is_active = true,
        updated_at = NOW();
  `);

  pgm.sql(`
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
      sort_order
    )
    SELECT
      v.achievement_key,
      v.title,
      v.description,
      'standard',
      NULL,
      'collection',
      'progress',
      ${TARGET_PER_SET},
      'rare',
      ${REWARD_GEMS},
      0,
      0,
      0,
      v.reward_border_id,
      NULL,
      true,
      v.sort_order
    FROM (VALUES
      ${buildAchievementValuesSql()}
    ) AS v(achievement_key, title, description, reward_border_id, sort_order)
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
        updated_at = NOW();
  `);
};

exports.down = (pgm) => {
  const keys = SET_COLLECTION_ACHIEVEMENTS.map(
    (a) => `'${a.achievement_key}'`
  ).join(", ");

  pgm.sql(`
    DELETE FROM achievements
    WHERE achievement_key IN (${keys});
  `);
  // Borders are intentionally left in place — they may be referenced by other
  // migrations or already owned by users.
};
