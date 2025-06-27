/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  pgm.createTable("user_card_xp_pools", {
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(user_id)",
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    },
    card_name: {
      type: "varchar(100)",
      notNull: true,
    },
    available_xp: {
      type: "integer",
      notNull: true,
      default: 0,
      check: "available_xp >= 0",
    },
    total_earned_xp: {
      type: "integer",
      notNull: true,
      default: 0,
      check: "total_earned_xp >= 0",
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

  // Create primary key constraint
  pgm.addConstraint("user_card_xp_pools", "pk_user_card_xp_pools", {
    primaryKey: ["user_id", "card_name"],
  });

  // Create indexes for performance
  pgm.createIndex("user_card_xp_pools", "user_id");
  pgm.createIndex("user_card_xp_pools", "card_name");
  pgm.createIndex("user_card_xp_pools", ["user_id", "card_name"]);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.dropIndex("user_card_xp_pools", ["user_id", "card_name"]);
  pgm.dropIndex("user_card_xp_pools", "card_name");
  pgm.dropIndex("user_card_xp_pools", "user_id");
  pgm.dropConstraint("user_card_xp_pools", "pk_user_card_xp_pools");
  pgm.dropTable("user_card_xp_pools");
};
