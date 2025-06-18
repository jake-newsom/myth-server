/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  // 1. Add pack_count column to users table
  pgm.addColumn("users", {
    pack_count: {
      type: "integer",
      notNull: true,
      default: 0,
      check: "pack_count >= 0",
    },
  });

  // 2. Migrate existing data - sum all packs per user from user_packs table
  pgm.sql(`
    UPDATE users SET pack_count = (
      SELECT COALESCE(SUM(quantity), 0) 
      FROM user_packs 
      WHERE user_packs.user_id = users.user_id
    );
  `);

  // 3. Drop the user_packs table and its indexes
  pgm.dropIndex("user_packs", ["user_id", "set_id"]);
  pgm.dropIndex("user_packs", "set_id");
  pgm.dropIndex("user_packs", "user_id");
  pgm.dropConstraint("user_packs", "unique_user_set");
  pgm.dropTable("user_packs");

  // 4. Create index on pack_count for performance
  pgm.createIndex("users", "pack_count");
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Reverse the migration

  // 1. Recreate user_packs table
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

  // 2. Recreate constraints and indexes
  pgm.addConstraint("user_packs", "unique_user_set", {
    unique: ["user_id", "set_id"],
  });
  pgm.createIndex("user_packs", "user_id");
  pgm.createIndex("user_packs", "set_id");
  pgm.createIndex("user_packs", ["user_id", "set_id"]);

  // 3. Remove pack_count column and its index
  pgm.dropIndex("users", "pack_count");
  pgm.dropColumn("users", "pack_count");
};
