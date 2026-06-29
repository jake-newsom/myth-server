/* eslint-disable camelcase */

/**
 * Season rewards now pay out on two axes (personal overall rank + the player's
 * pantheon's faction-race placement), each delivered as its own payout + mail.
 *
 * Add an `axis` column to season_reward_payouts and re-key its uniqueness from
 * (season_id, user_id) to (season_id, user_id, axis) so a player can hold one
 * payout row per axis.
 */

exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.addColumn("season_reward_payouts", {
    axis: {
      type: "text",
      notNull: true,
      default: "overall",
    },
  });

  pgm.addConstraint(
    "season_reward_payouts",
    "season_reward_payouts_axis_check",
    "CHECK (axis IN ('overall', 'pantheon'))"
  );

  // Replace the old per-user uniqueness with per-user-per-axis.
  pgm.dropConstraint(
    "season_reward_payouts",
    "season_reward_payouts_unique_user_season"
  );
  pgm.addConstraint(
    "season_reward_payouts",
    "season_reward_payouts_unique_user_season_axis",
    "UNIQUE (season_id, user_id, axis)"
  );
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropConstraint(
    "season_reward_payouts",
    "season_reward_payouts_unique_user_season_axis"
  );
  pgm.addConstraint(
    "season_reward_payouts",
    "season_reward_payouts_unique_user_season",
    "UNIQUE (season_id, user_id)"
  );
  pgm.dropConstraint(
    "season_reward_payouts",
    "season_reward_payouts_axis_check"
  );
  pgm.dropColumn("season_reward_payouts", "axis");
};
