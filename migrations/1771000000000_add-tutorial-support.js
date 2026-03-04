/**
 * Migration: Add tutorial support
 *
 * - Add is_tutorial boolean column to games table
 * - Make player1_deck_id nullable (tutorial games have no real decks)
 * - Add '3x3' to board_layout enum
 * - Add tutorial_completed_at timestamp to users table
 */

exports.up = (pgm) => {
  // Add '3x3' to board_layout enum
  pgm.addTypeValue("board_layout", "3x3");

  // Add is_tutorial column to games table
  pgm.addColumn("games", {
    is_tutorial: {
      type: "boolean",
      notNull: true,
      default: false,
    },
  });

  // Make player1_deck_id nullable for tutorial games (which have no real decks)
  pgm.alterColumn("games", "player1_deck_id", {
    notNull: false,
  });

  // Add tutorial_completed_at to users table
  pgm.addColumn("users", {
    tutorial_completed_at: {
      type: "timestamp",
      default: null,
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("users", "tutorial_completed_at");

  pgm.alterColumn("games", "player1_deck_id", {
    notNull: true,
  });

  pgm.dropColumn("games", "is_tutorial");

  // Note: PostgreSQL doesn't support removing enum values easily.
  // The '3x3' value will remain in the enum on rollback.
};
