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
  // Add card_fragments column to users table
  pgm.addColumn('users', {
    card_fragments: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
  });

  // Add constraint to ensure card_fragments is non-negative
  pgm.addConstraint('users', 'users_card_fragments_check', {
    check: 'card_fragments >= 0',
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Remove constraint first
  pgm.dropConstraint('users', 'users_card_fragments_check');
  
  // Remove card_fragments column
  pgm.dropColumn('users', 'card_fragments');
};