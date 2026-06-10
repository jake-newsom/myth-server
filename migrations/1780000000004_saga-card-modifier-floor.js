/**
 * Track which floor saga card buffs/runes were earned on (GDD §13.2 defeat reset)
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.addColumn("saga_cards", {
    modifier_floor: {
      type: "integer",
      notNull: true,
      default: 1,
      comment:
        "Floor when card last received a buff/rune; used to strip current-floor modifiers on defeat",
    },
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropColumn("saga_cards", "modifier_floor", { ifExists: true });
};
