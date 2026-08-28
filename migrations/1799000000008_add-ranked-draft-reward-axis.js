/* eslint-disable camelcase */

/**
 * Make the Ranked Draft ladder's seasonal payouts configurable.
 *
 * Until now the ladder's reward bands lived in a hardcoded array in
 * rankedDraftRewards.service.ts, so changing a payout meant a server deploy.
 * This adds a third `season_reward_tiers` axis, `ranked_draft`, which the admin
 * console edits exactly like the existing overall/pantheon axes.
 *
 * The axis differs from the other two in HOW a tier is matched. overall and
 * pantheon resolve by threshold (ladder position / placement); this axis
 * resolves by PvP RANK KEY — `tier_key` holds the pvpRanks key the player
 * finished with (see src/config/pvpRanks.ts), which is what the payout job
 * already keys off. threshold_kind/threshold_value are NOT NULL on the table so
 * they are still populated, but nothing reads them for this axis.
 *
 * `axis` is a text column with a CHECK constraint (not a PG enum), so widening
 * it is a plain in-transaction constraint swap — no separate enum migration.
 *
 * Release-safety: purely additive. The seeded rows reproduce the hardcoded
 * values exactly, and the service keeps that array as a fallback, so a missing
 * or empty config pays out precisely what it pays out today. The whole payout
 * remains behind the `ranked-draft-rewards` feature flag.
 */

exports.shorthands = undefined;

/**
 * The current SEASONAL_REWARD_TIERS, verbatim. Seeding the live values (rather
 * than fresh numbers) is what makes this migration a no-op behaviourally.
 */
const rankedDraftTiers = [
  { tier_key: "zenith",      sort_order: 0, label: "Zenith",      threshold_value: 8, gems: 6000, packs: 30 },
  { tier_key: "worldforger", sort_order: 1, label: "Worldforger", threshold_value: 7, gems: 3500, packs: 20 },
  { tier_key: "titan",       sort_order: 2, label: "Titan",       threshold_value: 6, gems: 1800, packs: 12 },
  { tier_key: "immortal",    sort_order: 3, label: "Immortal",    threshold_value: 5, gems: 900,  packs: 6 },
  { tier_key: "ascendant",   sort_order: 4, label: "Ascendant",   threshold_value: 4, gems: 500,  packs: 4 },
  { tier_key: "chosen",      sort_order: 5, label: "Chosen",      threshold_value: 3, gems: 300,  packs: 2 },
  { tier_key: "champion",    sort_order: 6, label: "Champion",    threshold_value: 2, gems: 150,  packs: 1 },
  { tier_key: "seeker",      sort_order: 7, label: "Seeker",      threshold_value: 1, gems: 75,   packs: 1 },
];

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  // Widen the axis CHECK. Named constraint may not exist on databases whose
  // axis column came from the current 1783000000000 rather than the 
  // 1783000000002 backfill, so drop defensively before adding.
  pgm.sql(`
    ALTER TABLE season_reward_tiers
      DROP CONSTRAINT IF EXISTS season_reward_tiers_axis_check;
    ALTER TABLE season_reward_tiers
      ADD CONSTRAINT season_reward_tiers_axis_check
      CHECK (axis IN ('overall', 'pantheon', 'ranked_draft'));
  `);

  // Record what a ranked payout actually delivered. reward_gems/reward_packs
  // stay as they are (still written, still the authoritative currency record);
  // this captures the cosmetic half of a bundle so a payout is auditable after
  // the config it came from has been edited. Nullable: every existing row
  // predates cosmetics.
  pgm.addColumns("ranked_draft_season_payouts", {
    bundle_json: { type: "jsonb", notNull: false },
  });

  for (const t of rankedDraftTiers) {
    const bundle = {
      gems: t.gems,
      packs: t.packs,
      card_variant_ids: [],
      border_ids: [],
      card_back_ids: [],
      display: { card_count: 0, card_label: null, cosmetic_labels: [] },
    };
    pgm.sql(
      `INSERT INTO season_reward_tiers
         (season_id, axis, tier_key, sort_order, label, threshold_kind, threshold_value, bundle_json)
       VALUES
         (NULL, 'ranked_draft', $pgm$${t.tier_key}$pgm$, ${t.sort_order},
          $pgm$${t.label}$pgm$, 'exact_rank', ${t.threshold_value},
          $pgm$${JSON.stringify(bundle)}$pgm$::jsonb)
       ON CONFLICT DO NOTHING;`
    );
  }
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.sql(`DELETE FROM season_reward_tiers WHERE axis = 'ranked_draft';`);
  pgm.dropColumns("ranked_draft_season_payouts", ["bundle_json"]);
  pgm.sql(`
    ALTER TABLE season_reward_tiers
      DROP CONSTRAINT IF EXISTS season_reward_tiers_axis_check;
    ALTER TABLE season_reward_tiers
      ADD CONSTRAINT season_reward_tiers_axis_check
      CHECK (axis IN ('overall', 'pantheon'));
  `);
};
