/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  pgm.createTable("deck_cards", {
    deck_card_id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("uuid_generate_v4()"),
    },
    deck_id: {
      type: "uuid",
      notNull: true,
      references: "decks(deck_id)",
      onDelete: "CASCADE",
    },
    user_card_instance_id: {
      type: "uuid",
      notNull: true,
      references: "user_owned_cards(user_card_instance_id)",
      onDelete: "CASCADE",
    },
  });

  // Create indexes for performance
  pgm.createIndex("deck_cards", "deck_id");
  pgm.createIndex("deck_cards", "user_card_instance_id");

  // Add unique constraint to prevent duplicate cards in a deck
  pgm.addConstraint("deck_cards", "unique_card_in_deck", {
    unique: ["deck_id", "user_card_instance_id"],
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.dropConstraint("deck_cards", "unique_card_in_deck");
  pgm.dropIndex("deck_cards", "user_card_instance_id");
  pgm.dropIndex("deck_cards", "deck_id");
  pgm.dropTable("deck_cards");
};
