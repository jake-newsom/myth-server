/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  // Add new currency columns
  pgm.addColumn("users", {
    gold: {
      type: "integer",
      notNull: true,
      default: 0,
      check: "gold >= 0",
    },
    gems: {
      type: "integer",
      notNull: true,
      default: 0,
      check: "gems >= 0",
    },
    total_xp: {
      type: "integer",
      notNull: true,
      default: 0,
      check: "total_xp >= 0",
    },
  });

  // Migrate existing in_game_currency to gold
  pgm.sql(
    `UPDATE "users" SET gold = in_game_currency WHERE in_game_currency > 0;`
  );

  // Create indexes for performance
  pgm.createIndex("users", "gold");
  pgm.createIndex("users", "gems");
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Restore in_game_currency from gold before dropping
  pgm.sql(`UPDATE "users" SET in_game_currency = gold WHERE gold > 0;`);

  pgm.dropIndex("users", "gems");
  pgm.dropIndex("users", "gold");
  pgm.dropColumn("users", "total_xp");
  pgm.dropColumn("users", "gems");
  pgm.dropColumn("users", "gold");
};
