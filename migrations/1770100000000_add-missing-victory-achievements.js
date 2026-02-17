/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  // Add missing achievement records that are referenced in achievement.service.ts
  // but were never added to the database.
  // close_victory: Win a game by 1-2 points
  // dominant_victory: Win a game by 10+ points
  pgm.sql(`
    INSERT INTO achievements (
      achievement_key, title, description, category, type, target_value,
      rarity, reward_gems, reward_packs, sort_order
    ) VALUES
    ('close_victory', 'Nail Biter', 'Win a game by 1-2 points', 'gameplay', 'single', 1, 'rare', 5, 0, 6),
    ('dominant_victory', 'Total Domination', 'Win a game by 10 or more points', 'gameplay', 'single', 1, 'uncommon', 3, 0, 7)
    ON CONFLICT (achievement_key) DO NOTHING;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM achievements WHERE achievement_key IN ('close_victory', 'dominant_victory');
  `);
};
