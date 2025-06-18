/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  // Add set_id column to cards table
  pgm.addColumn("cards", {
    set_id: {
      type: "uuid",
      references: "sets(set_id)",
      onDelete: "RESTRICT",
      onUpdate: "CASCADE",
    },
  });

  // Create index for performance
  pgm.createIndex("cards", "set_id");
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.dropIndex("cards", "set_id");
  pgm.dropColumn("cards", "set_id");
};
