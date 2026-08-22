/* eslint-disable camelcase */

/**
 * Season reward tiers — percentile floor (`min_players`).
 *
 * A percentile tier ("Top 10%") is very thin on a small season: 40 ranked
 * players means only 4 people ever see the tier. `min_players` gives a
 * percentile tier a MINIMUM number of ranks it covers, so the cutoff becomes
 *
 *   cutoff = min(total_ranked, max(1, ceil(pct/100 * total_ranked), min_players))
 *
 * i.e. it only ever WIDENS a tier, never narrows it, and never exceeds the
 * number of ranked players.
 *
 * NULL = no floor = exactly the previous behavior, so existing rows (including
 * any per-season override rows) are unaffected until explicitly given a value.
 * Ignored entirely for `exact_rank` tiers.
 */

exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.addColumn("season_reward_tiers", {
    min_players: {
      type: "integer",
      notNull: false,
      default: null,
    },
  });

  pgm.addConstraint(
    "season_reward_tiers",
    "season_reward_tiers_min_players_check",
    "CHECK (min_players IS NULL OR min_players >= 1)"
  );

  // Give the default "Top 10%" template tier a floor of 15 players. Only the
  // template row (season_id IS NULL) is touched; per-season override rows keep
  // whatever an admin configured for them.
  pgm.sql(`
    UPDATE season_reward_tiers
       SET min_players = 15,
           updated_at = NOW()
     WHERE season_id IS NULL
       AND axis = 'overall'
       AND tier_key = 'top_10'
       AND threshold_kind = 'percentile'
       AND min_players IS NULL;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropConstraint(
    "season_reward_tiers",
    "season_reward_tiers_min_players_check"
  );
  pgm.dropColumn("season_reward_tiers", "min_players");
};
