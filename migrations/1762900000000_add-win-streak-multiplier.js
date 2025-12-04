/**
 * Migration: Add win streak multiplier to users table
 * 
 * Adds a win_streak_multiplier field to track online game win streaks.
 * - Starts at 1.0 for new users
 * - Increases by 0.1 for each consecutive win (max 5.0)
 * - Resets to 1.0 on any loss
 * - Only applies to PvP (online) games
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  // Add win_streak_multiplier column to users table
  pgm.addColumn("users", {
    win_streak_multiplier: {
      type: "decimal(3,1)",
      notNull: true,
      default: 1.0,
    },
  });
  
  console.log('Added win_streak_multiplier column to users table');
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Remove win_streak_multiplier column from users table
  pgm.dropColumn("users", "win_streak_multiplier");
  
  console.log('Removed win_streak_multiplier column from users table');
};
