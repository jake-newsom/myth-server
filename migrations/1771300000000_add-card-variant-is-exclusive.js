/**
 * Add is_exclusive column to card_variants table.
 * Exclusive cards cannot be obtained via packs, shop, or reward systems —
 * they can only be granted through the mail system.
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.addColumn("card_variants", {
    is_exclusive: {
      type: "boolean",
      notNull: true,
      default: false,
    },
  });

  pgm.createIndex("card_variants", "is_exclusive");
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropColumn("card_variants", "is_exclusive");
};
