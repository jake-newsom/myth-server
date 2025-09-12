/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  pgm.createTable("user_owned_cards", {
    user_card_instance_id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("uuid_generate_v4()"),
    },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(user_id)",
      onDelete: "CASCADE",
    },
    card_id: {
      type: "uuid",
      notNull: true,
      references: "cards(card_id)",
      onDelete: "CASCADE",
    },
    level: {
      type: "integer",
      notNull: true,
      default: 1,
      check: "level > 0",
    },
    xp: {
      type: "integer",
      notNull: true,
      default: 0,
      check: "xp >= 0",
    },
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  // Create indexes for performance
  pgm.createIndex("user_owned_cards", "user_id");
  pgm.createIndex("user_owned_cards", "card_id");
  pgm.createIndex("user_owned_cards", ["user_id", "card_id"]);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.dropIndex("user_owned_cards", ["user_id", "card_id"]);
  pgm.dropIndex("user_owned_cards", "card_id");
  pgm.dropIndex("user_owned_cards", "user_id");
  pgm.dropTable("user_owned_cards");
};
