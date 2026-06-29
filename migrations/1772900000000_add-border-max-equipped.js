/**
 * Optional per-border application cap.
 *
 * Adds card_borders.max_equipped — the maximum number of a user's card
 * instances that may have this border equipped at one time.
 *
 *   - NULL                → unlimited (existing behavior, the default)
 *   - positive integer N  → a user may have at most N cards equipped with it
 *
 * Semantics are "in use", not "applied ever": unequipping a card frees a slot.
 * Enforcement happens server-side at equip time inside the equip UPDATE (see
 * BorderModel.equipBorderOnInstance / equipBorderOnAllEmpty).
 */

exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.addColumn("card_borders", {
    max_equipped: {
      type: "integer",
      notNull: false,
    },
  });

  pgm.addConstraint("card_borders", "card_borders_max_equipped_positive", {
    check: "max_equipped IS NULL OR max_equipped > 0",
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropConstraint("card_borders", "card_borders_max_equipped_positive", {
    ifExists: true,
  });
  pgm.dropColumn("card_borders", "max_equipped");
};
