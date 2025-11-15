/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  // Drop the old constraint
  pgm.sql(`
    ALTER TABLE achievements 
    DROP CONSTRAINT IF EXISTS achievements_category_check;
  `);

  // Add the new constraint with 'story_mode' included
  pgm.addConstraint("achievements", "achievements_category_check", {
    check: "category IN ('gameplay', 'collection', 'social', 'progression', 'special', 'story_mode')",
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Revert to original constraint
  pgm.sql(`
    ALTER TABLE achievements 
    DROP CONSTRAINT IF EXISTS achievements_category_check;
  `);

  pgm.addConstraint("achievements", "achievements_category_check", {
    check: "category IN ('gameplay', 'collection', 'social', 'progression', 'special')",
  });
};

