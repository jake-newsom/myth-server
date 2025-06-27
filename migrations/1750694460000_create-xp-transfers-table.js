/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  // Create enum type for transfer types
  pgm.createType("xp_transfer_type", [
    "card_to_card",
    "sacrifice_to_pool",
    "pool_to_card",
    "game_reward_to_pool",
  ]);

  pgm.createTable("xp_transfers", {
    id: {
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
    transfer_type: {
      type: "xp_transfer_type",
      notNull: true,
    },
    source_card_ids: {
      type: "uuid[]",
      comment: "Array of source card instance IDs (for direct transfers)",
    },
    target_card_id: {
      type: "uuid",
      references: "user_owned_cards(user_card_instance_id)",
      onDelete: "SET NULL",
      onUpdate: "CASCADE",
    },
    card_name: {
      type: "varchar(100)",
      notNull: true,
      comment: "All transfers must be for same card name",
    },
    xp_transferred: {
      type: "integer",
      notNull: true,
      check: "xp_transferred > 0",
    },
    efficiency_rate: {
      type: "decimal(3,2)",
      comment: "Rate of XP transfer efficiency (e.g., 0.50 for 50%)",
    },
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  // Create indexes for performance
  pgm.createIndex("xp_transfers", "user_id");
  pgm.createIndex("xp_transfers", "transfer_type");
  pgm.createIndex("xp_transfers", "card_name");
  pgm.createIndex("xp_transfers", "target_card_id");
  pgm.createIndex("xp_transfers", "created_at");
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.dropIndex("xp_transfers", "created_at");
  pgm.dropIndex("xp_transfers", "target_card_id");
  pgm.dropIndex("xp_transfers", "card_name");
  pgm.dropIndex("xp_transfers", "transfer_type");
  pgm.dropIndex("xp_transfers", "user_id");
  pgm.dropTable("xp_transfers");
  pgm.dropType("xp_transfer_type");
};
