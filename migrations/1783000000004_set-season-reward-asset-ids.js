/* eslint-disable camelcase */

/**
 * Assign the real cosmetic asset ids to the template reward tiers
 * (season_id IS NULL), superseding the dev sample ids from
 * 1783000000003_seed-sample-reward-assets.
 *
 *   Overall #1 (first):       cards [f897ca8d…, eac9115c…], frame 8f1dded2…, back 293df1dd…
 *   Overall Top 10% (top_10): card  [eac9115c…],            frame d7ee166d…
 *   Winning Pantheon (pantheon_1): frame 88539321…
 *
 * Per season, these can be overridden via the admin SeasonRewardsPanel.
 */

const CARD_1 = "f897ca8d-6f3c-4d61-85e8-be49b7d25939";
const CARD_2 = "eac9115c-94c3-434e-a8cd-7b41c91a1ad1";
const TOP10_CARD = "eac9115c-94c3-434e-a8cd-7b41c91a1ad1";
const FIRST_BORDER = "8f1dded2-b3b9-478b-81e9-fe3ae145304e";
const TOP10_BORDER = "d7ee166d-9fbe-49ee-b637-d437e690448b";
const PANTHEON_BORDER = "88539321-0bd2-4075-a05f-d5e8d0738026";
const FIRST_BACK = "293df1dd-7e69-493b-832a-85b9aee1f9c5";

exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  // Overall #1: two cards, frame, card back.
  pgm.sql(`
    UPDATE season_reward_tiers
    SET bundle_json = bundle_json
      || jsonb_build_object(
           'card_variant_ids', jsonb_build_array('${CARD_1}', '${CARD_2}'),
           'border_ids',       jsonb_build_array('${FIRST_BORDER}'),
           'card_back_ids',    jsonb_build_array('${FIRST_BACK}')
         ),
        updated_at = NOW()
    WHERE season_id IS NULL AND axis = 'overall' AND tier_key = 'first';
  `);

  // Overall Top 10%: one card, frame.
  pgm.sql(`
    UPDATE season_reward_tiers
    SET bundle_json = bundle_json
      || jsonb_build_object(
           'card_variant_ids', jsonb_build_array('${TOP10_CARD}'),
           'border_ids',       jsonb_build_array('${TOP10_BORDER}'),
           'card_back_ids',    jsonb_build_array()
         ),
        updated_at = NOW()
    WHERE season_id IS NULL AND axis = 'overall' AND tier_key = 'top_10';
  `);

  // Winning Pantheon: champion frame.
  pgm.sql(`
    UPDATE season_reward_tiers
    SET bundle_json = bundle_json
      || jsonb_build_object(
           'border_ids', jsonb_build_array('${PANTHEON_BORDER}')
         ),
        updated_at = NOW()
    WHERE season_id IS NULL AND axis = 'pantheon' AND tier_key = 'pantheon_1';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  // Clear the assigned asset ids back to empty arrays on the affected templates.
  pgm.sql(`
    UPDATE season_reward_tiers
    SET bundle_json = bundle_json
      || '{"card_variant_ids":[],"border_ids":[],"card_back_ids":[]}'::jsonb,
        updated_at = NOW()
    WHERE season_id IS NULL
      AND ((axis = 'overall' AND tier_key IN ('first', 'top_10'))
        OR (axis = 'pantheon' AND tier_key = 'pantheon_1'));
  `);
};
