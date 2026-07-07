/**
 * Idempotency guard for PvP game reward processing.
 *
 * Inserts a row before granting gems/XP/leaderboard updates. If the row
 * already exists (concurrent grace-timer + action-completion race, or a
 * retry), the INSERT is a no-op and the caller skips the reward work.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.createTable("game_rewards_granted", {
    game_id: { type: "uuid", notNull: true },
    user_id: { type: "uuid", notNull: true },
    granted_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.addConstraint(
    "game_rewards_granted",
    "game_rewards_granted_pkey",
    "PRIMARY KEY (game_id, user_id)"
  );

  pgm.createIndex("game_rewards_granted", "user_id");
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropTable("game_rewards_granted");
};
