/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  pgm.createTable("user_packs", {
    user_pack_id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("uuid_generate_v4()"),
    },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(user_id)",
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    },
    set_id: {
      type: "uuid",
      notNull: true,
      references: "sets(set_id)",
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    },
    quantity: {
      type: "integer",
      notNull: true,
      default: 0,
      check: "quantity >= 0",
    },
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
    updated_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  // Create unique constraint to prevent duplicate user/set combinations
  pgm.addConstraint("user_packs", "unique_user_set", {
    unique: ["user_id", "set_id"],
  });

  // Create indexes for performance
  pgm.createIndex("user_packs", "user_id");
  pgm.createIndex("user_packs", "set_id");
  pgm.createIndex("user_packs", ["user_id", "set_id"]);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.dropIndex("user_packs", ["user_id", "set_id"]);
  pgm.dropIndex("user_packs", "set_id");
  pgm.dropIndex("user_packs", "user_id");
  pgm.dropConstraint("user_packs", "unique_user_set");
  pgm.dropTable("user_packs");
};
