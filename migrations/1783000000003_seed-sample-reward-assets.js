/* eslint-disable camelcase */

/**
 * Dev convenience: seed the template reward tiers with SAMPLE real asset ids
 * (an existing card variant, border, and card back) so the rewards modal can
 * render real card / border / card-back previews before the season's bespoke
 * art exists. Replace these per season via the admin SeasonRewardsPanel.
 *
 * Only fills bundles whose asset arrays are currently empty, so it never
 * clobbers ids an admin has already assigned. No-ops gracefully if the DB has
 * no variants/borders/backs yet.
 */

exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  // Pick one sample id of each type (NULL if none exist).
  // Cards: give the #1 tier two copies of the same sample variant, top_10 one.
  pgm.sql(`
    DO $$
    DECLARE
      v_card uuid;
      v_border uuid;
      v_back uuid;
    BEGIN
      SELECT card_variant_id INTO v_card FROM card_variants ORDER BY created_at LIMIT 1;
      SELECT border_id INTO v_border FROM card_borders WHERE is_active = true ORDER BY created_at LIMIT 1;
      SELECT back_id INTO v_back FROM card_backs WHERE is_active = true ORDER BY created_at LIMIT 1;

      -- ---- Overall #1: 2 cards, frame + back ----
      IF v_card IS NOT NULL THEN
        UPDATE season_reward_tiers
          SET bundle_json = jsonb_set(bundle_json, '{card_variant_ids}',
              to_jsonb(ARRAY[v_card, v_card]))
          WHERE season_id IS NULL AND axis = 'overall' AND tier_key = 'first'
            AND jsonb_array_length(bundle_json->'card_variant_ids') = 0;
      END IF;
      IF v_border IS NOT NULL THEN
        UPDATE season_reward_tiers
          SET bundle_json = jsonb_set(bundle_json, '{border_ids}', to_jsonb(ARRAY[v_border]))
          WHERE season_id IS NULL AND axis = 'overall' AND tier_key = 'first'
            AND jsonb_array_length(bundle_json->'border_ids') = 0;
      END IF;
      IF v_back IS NOT NULL THEN
        UPDATE season_reward_tiers
          SET bundle_json = jsonb_set(bundle_json, '{card_back_ids}', to_jsonb(ARRAY[v_back]))
          WHERE season_id IS NULL AND axis = 'overall' AND tier_key = 'first'
            AND jsonb_array_length(bundle_json->'card_back_ids') = 0;
      END IF;

      -- ---- Overall top 10%: 1 card, frame ----
      IF v_card IS NOT NULL THEN
        UPDATE season_reward_tiers
          SET bundle_json = jsonb_set(bundle_json, '{card_variant_ids}', to_jsonb(ARRAY[v_card]))
          WHERE season_id IS NULL AND axis = 'overall' AND tier_key = 'top_10'
            AND jsonb_array_length(bundle_json->'card_variant_ids') = 0;
      END IF;
      IF v_border IS NOT NULL THEN
        UPDATE season_reward_tiers
          SET bundle_json = jsonb_set(bundle_json, '{border_ids}', to_jsonb(ARRAY[v_border]))
          WHERE season_id IS NULL AND axis = 'overall' AND tier_key = 'top_10'
            AND jsonb_array_length(bundle_json->'border_ids') = 0;
      END IF;

      -- ---- Pantheon winner: champion frame ----
      IF v_border IS NOT NULL THEN
        UPDATE season_reward_tiers
          SET bundle_json = jsonb_set(bundle_json, '{border_ids}', to_jsonb(ARRAY[v_border]))
          WHERE season_id IS NULL AND axis = 'pantheon' AND tier_key = 'pantheon_1'
            AND jsonb_array_length(bundle_json->'border_ids') = 0;
      END IF;
    END $$;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  // Clear the sample ids back to empty arrays on the template tiers.
  pgm.sql(`
    UPDATE season_reward_tiers
      SET bundle_json = bundle_json
        || '{"card_variant_ids":[],"border_ids":[],"card_back_ids":[]}'::jsonb
      WHERE season_id IS NULL;
  `);
};
