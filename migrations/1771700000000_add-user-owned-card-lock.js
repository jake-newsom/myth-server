/**
 * Add is_locked column to user_owned_cards.
 *
 * Locked cards cannot be sacrificed and cannot be used
 * as a source card for XP transfer.
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.addColumn("user_owned_cards", {
    is_locked: {
      type: "boolean",
      notNull: true,
      default: false,
    },
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropColumn("user_owned_cards", "is_locked");
};
