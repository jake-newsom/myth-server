/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  pgm.createTable("pack_opening_history", {
    pack_opening_id: {
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
    set_id: {
      type: "uuid",
      notNull: true,
      references: "sets(set_id)",
      onDelete: "CASCADE",
    },
    card_ids: {
      type: "jsonb",
      notNull: true,
      comment: "Array of card IDs that were obtained in this pack opening",
    },
    opened_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  // Create indexes for performance
  pgm.createIndex("pack_opening_history", "user_id");
  pgm.createIndex("pack_opening_history", "set_id");
  pgm.createIndex("pack_opening_history", "opened_at");
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.dropIndex("pack_opening_history", "opened_at");
  pgm.dropIndex("pack_opening_history", "set_id");
  pgm.dropIndex("pack_opening_history", "user_id");
  pgm.dropTable("pack_opening_history");
};
