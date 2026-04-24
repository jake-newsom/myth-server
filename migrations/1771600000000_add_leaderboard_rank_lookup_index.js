/**
 * Add composite index to optimize leaderboard rank lookups.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS user_rankings_season_rating_wins_user_desc_idx
    ON user_rankings (season, rating DESC, wins DESC, user_id);
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS user_rankings_season_rating_wins_user_desc_idx;
  `);
};

