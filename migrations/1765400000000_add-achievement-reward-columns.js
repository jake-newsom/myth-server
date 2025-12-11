/**
 * Update achievement reward columns:
 * - Add reward_fate_coins
 * - Add reward_card_fragments
 * - Remove reward_gold (no longer used in game)
 * 
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  // Add reward_fate_coins column
  pgm.addColumn("achievements", {
    reward_fate_coins: {
      type: "integer",
      notNull: false,
      default: 0,
      comment: "Fate coins awarded when achievement is claimed",
    },
  });

  // Add reward_card_fragments column
  pgm.addColumn("achievements", {
    reward_card_fragments: {
      type: "integer",
      notNull: false,
      default: 0,
      comment: "Card fragments awarded when achievement is claimed",
    },
  });

  // Add check constraints to ensure non-negative rewards
  pgm.addConstraint("achievements", "reward_fate_coins_check", {
    check: "reward_fate_coins >= 0",
  });

  pgm.addConstraint("achievements", "reward_card_fragments_check", {
    check: "reward_card_fragments >= 0",
  });

  // Remove reward_gold column (no longer used in game)
  pgm.dropColumn("achievements", "reward_gold");

  console.log('✓ Added reward_fate_coins and reward_card_fragments columns');
  console.log('✓ Removed reward_gold column (no longer used)');
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Restore reward_gold column (in case of rollback)
  pgm.addColumn("achievements", {
    reward_gold: {
      type: "integer",
      default: 0,
    },
  });

  // Drop constraints first
  pgm.dropConstraint("achievements", "reward_card_fragments_check");
  pgm.dropConstraint("achievements", "reward_fate_coins_check");

  // Drop columns
  pgm.dropColumn("achievements", "reward_card_fragments");
  pgm.dropColumn("achievements", "reward_fate_coins");
};
