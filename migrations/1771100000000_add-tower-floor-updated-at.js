/**
 * Migration: Add tower_floor_updated_at to users table
 * Tracks the timestamp when a user last advanced to a new tower floor,
 * used as a tiebreaker in the tower leaderboard (earlier = ranked higher).
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.addColumn("users", {
    tower_floor_updated_at: {
      type: "timestamptz",
      notNull: false,
      comment: "Timestamp of the last tower floor advancement",
    },
  });

  // Backfill existing rows with the user's created_at as a safe default
  // (treats all pre-migration users as having reached their floor at account creation)
  pgm.sql(`
    UPDATE users SET tower_floor_updated_at = created_at WHERE tower_floor_updated_at IS NULL;
  `);

  pgm.createIndex("users", "tower_floor", {
    name: "idx_users_tower_floor",
    ifNotExists: true,
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropIndex("users", "tower_floor", { name: "idx_users_tower_floor", ifExists: true });
  pgm.dropColumn("users", "tower_floor_updated_at");
};
