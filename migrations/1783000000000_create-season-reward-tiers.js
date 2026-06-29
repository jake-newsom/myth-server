/* eslint-disable camelcase */

/**
 * Season ranking rewards — tier definitions.
 *
 * Players are placed into a reward tier at season finalization based on their
 * overall souls rank. Each tier carries a `bundle_json` describing what that
 * tier receives (gems/packs/cards/borders/card-backs) plus display metadata
 * for the in-app rewards modal.
 *
 * Tiers are NON-cumulative: a player receives exactly one tier's bundle.
 *
 * A row with `season_id = NULL` is a TEMPLATE row — the default bundles used
 * for any season that has no season-specific overrides. Per-season rows
 * (season_id set) override the template for that season.
 */

exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.createTable("season_reward_tiers", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    // NULL = template (default) row applied to any season without overrides.
    season_id: {
      type: "text",
      references: "season_definitions(season_id)",
      onDelete: "CASCADE",
    },
    // Which ranking this tier rewards:
    //   overall   -> a player's personal rank across all players
    //   pantheon  -> a player's chosen pantheon's placement in the faction race
    //                (shared by every member of that pantheon)
    axis: {
      type: "text",
      notNull: true,
      default: "overall",
    },
    // Stable identity for a tier within a season+axis (or template+axis).
    tier_key: {
      type: "text",
      notNull: true,
    },
    // Display ordering / prestige order (0 = highest, e.g. #1).
    sort_order: {
      type: "integer",
      notNull: true,
      default: 0,
    },
    label: {
      type: "text",
      notNull: true,
    },
    // How membership in the tier is decided.
    //   exact_rank  -> rank <= threshold_value (e.g. 1 for the #1 player)
    //   percentile  -> rank within the top threshold_value percent of ranked players
    threshold_kind: {
      type: "text",
      notNull: true,
    },
    // Numeric threshold paired with threshold_kind.
    //   exact_rank  -> a rank (1, 3, ...)
    //   percentile  -> a percent (10 = top 10%, 50 = top 50%, 100 = everyone)
    threshold_value: {
      type: "numeric",
      notNull: true,
    },
    // Reward contents + display metadata. See module doc for shape.
    bundle_json: {
      type: "jsonb",
      notNull: true,
      default: "{}",
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
  });

  pgm.addConstraint(
    "season_reward_tiers",
    "season_reward_tiers_threshold_kind_check",
    "CHECK (threshold_kind IN ('exact_rank', 'percentile'))"
  );
  pgm.addConstraint(
    "season_reward_tiers",
    "season_reward_tiers_axis_check",
    "CHECK (axis IN ('overall', 'pantheon'))"
  );

  // One row per (season, axis, tier_key). For template rows season_id is NULL;
  // a partial unique index handles the NULL case (NULLs are distinct in the
  // plain UNIQUE constraint otherwise).
  pgm.addConstraint(
    "season_reward_tiers",
    "season_reward_tiers_unique_season_axis_tier",
    "UNIQUE (season_id, axis, tier_key)"
  );
  pgm.createIndex("season_reward_tiers", ["axis", "tier_key"], {
    name: "uq_season_reward_tiers_template_axis_tier",
    unique: true,
    where: "season_id IS NULL",
  });

  pgm.createIndex("season_reward_tiers", ["season_id", "axis", "sort_order"], {
    name: "idx_season_reward_tiers_season_axis_order",
  });

  // ---- Seed the default template (season_id = NULL) ----------------------
  // Two axes. Asset IDs (cards / borders / card backs) are intentionally empty
  // for now; they are filled in per season via the admin SeasonRewardsPanel
  // once the season's exclusive art exists. Currency/pack amounts are live
  // immediately. Amounts are split ~70% to the personal overall axis and ~30%
  // to the pantheon (faction-race) axis so a top finisher on the winning
  // pantheon nets roughly the original single-axis totals.
  const emptyAssets = {
    card_variant_ids: [],
    border_ids: [],
    card_back_ids: [],
  };

  // Axis 1: personal rank across all players.
  const overallTiers = [
    {
      tier_key: "first",
      sort_order: 0,
      label: "#1 Player",
      threshold_kind: "exact_rank",
      threshold_value: 1,
      bundle: {
        gems: 2800,
        packs: 21,
        ...emptyAssets,
        display: {
          card_count: 2,
          card_label: "Exclusive #1 season art (×2)",
          cosmetic_labels: ["Champion frame", "Champion card back"],
        },
      },
    },
    {
      tier_key: "top_10",
      sort_order: 1,
      label: "Top 10%",
      threshold_kind: "percentile",
      threshold_value: 10,
      bundle: {
        gems: 1400,
        packs: 13,
        ...emptyAssets,
        display: {
          card_count: 1,
          card_label: "Season art card",
          cosmetic_labels: ["Season frame"],
        },
      },
    },
    {
      tier_key: "top_50",
      sort_order: 2,
      label: "Top 50%",
      threshold_kind: "percentile",
      threshold_value: 50,
      bundle: {
        gems: 700,
        packs: 7,
        ...emptyAssets,
        display: { card_count: 0, card_label: null, cosmetic_labels: [] },
      },
    },
    {
      tier_key: "all",
      sort_order: 3,
      label: "All ranked players",
      threshold_kind: "percentile",
      threshold_value: 100,
      bundle: {
        gems: 280,
        packs: 3,
        ...emptyAssets,
        display: { card_count: 0, card_label: null, cosmetic_labels: [] },
      },
    },
  ];

  // Axis 2: the player's chosen pantheon's placement in the faction race.
  // threshold_value is the pantheon's placement (1st/2nd/3rd pantheon); every
  // member of a qualifying pantheon receives that tier's bundle.
  const pantheonTiers = [
    {
      tier_key: "pantheon_1",
      sort_order: 0,
      label: "Winning Pantheon",
      threshold_kind: "exact_rank",
      threshold_value: 1,
      bundle: {
        gems: 1200,
        packs: 9,
        ...emptyAssets,
        display: {
          card_count: 0,
          card_label: null,
          cosmetic_labels: ["Champion Pantheon frame"],
        },
      },
    },
    {
      tier_key: "pantheon_2",
      sort_order: 1,
      label: "2nd Pantheon",
      threshold_kind: "exact_rank",
      threshold_value: 2,
      bundle: {
        gems: 600,
        packs: 5,
        ...emptyAssets,
        display: { card_count: 0, card_label: null, cosmetic_labels: [] },
      },
    },
    {
      tier_key: "pantheon_3",
      sort_order: 2,
      label: "3rd Pantheon",
      threshold_kind: "exact_rank",
      threshold_value: 3,
      bundle: {
        gems: 300,
        packs: 3,
        ...emptyAssets,
        display: { card_count: 0, card_label: null, cosmetic_labels: [] },
      },
    },
  ];

  const seed = (axis, t) =>
    pgm.sql(
      `INSERT INTO season_reward_tiers
         (season_id, axis, tier_key, sort_order, label, threshold_kind, threshold_value, bundle_json)
       VALUES
         (NULL, $pgm$${axis}$pgm$, $pgm$${t.tier_key}$pgm$, ${t.sort_order},
          $pgm$${t.label}$pgm$, $pgm$${t.threshold_kind}$pgm$, ${t.threshold_value},
          $pgm$${JSON.stringify(t.bundle)}$pgm$::jsonb);`
    );

  for (const t of overallTiers) seed("overall", t);
  for (const t of pantheonTiers) seed("pantheon", t);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropTable("season_reward_tiers");
};
