/* eslint-disable camelcase */

/**
 * Add the `axis` column to season_reward_tiers for databases that applied an
 * earlier version of 1783000000000 before the two-axis (overall + pantheon)
 * schema landed. Existing rows are treated as the `overall` axis; pantheon
 * template tiers are seeded when missing.
 */

exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.addColumn("season_reward_tiers", {
    axis: {
      type: "text",
      notNull: true,
      default: "overall",
    },
  });

  pgm.addConstraint(
    "season_reward_tiers",
    "season_reward_tiers_axis_check",
    "CHECK (axis IN ('overall', 'pantheon'))"
  );

  pgm.dropConstraint(
    "season_reward_tiers",
    "season_reward_tiers_unique_season_tier"
  );
  pgm.sql("DROP INDEX IF EXISTS uq_season_reward_tiers_template_tier;");
  pgm.sql("DROP INDEX IF EXISTS idx_season_reward_tiers_season_order;");

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

  const emptyAssets = {
    card_variant_ids: [],
    border_ids: [],
    card_back_ids: [],
  };

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

  for (const t of pantheonTiers) {
    pgm.sql(
      `INSERT INTO season_reward_tiers
         (season_id, axis, tier_key, sort_order, label, threshold_kind, threshold_value, bundle_json)
       VALUES
         (NULL, 'pantheon', $pgm$${t.tier_key}$pgm$, ${t.sort_order},
          $pgm$${t.label}$pgm$, $pgm$${t.threshold_kind}$pgm$, ${t.threshold_value},
          $pgm$${JSON.stringify(t.bundle)}$pgm$::jsonb)
       ON CONFLICT DO NOTHING;`
    );
  }
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.sql(`DELETE FROM season_reward_tiers WHERE axis = 'pantheon';`);

  pgm.sql("DROP INDEX IF EXISTS idx_season_reward_tiers_season_axis_order;");
  pgm.sql("DROP INDEX IF EXISTS uq_season_reward_tiers_template_axis_tier;");
  pgm.dropConstraint(
    "season_reward_tiers",
    "season_reward_tiers_unique_season_axis_tier"
  );

  pgm.sql(
    "CREATE UNIQUE INDEX uq_season_reward_tiers_template_tier ON season_reward_tiers (tier_key) WHERE season_id IS NULL;"
  );
  pgm.sql(
    "CREATE INDEX idx_season_reward_tiers_season_order ON season_reward_tiers (season_id, sort_order);"
  );
  pgm.addConstraint(
    "season_reward_tiers",
    "season_reward_tiers_unique_season_tier",
    "UNIQUE (season_id, tier_key)"
  );

  pgm.dropConstraint(
    "season_reward_tiers",
    "season_reward_tiers_axis_check"
  );
  pgm.dropColumn("season_reward_tiers", "axis");
};
