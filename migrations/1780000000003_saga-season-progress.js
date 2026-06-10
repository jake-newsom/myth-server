/**
 * Per-player season currency & shop purchases (GDD §7)
 * Pending node rewards for card picks / battle buffs (GDD §4.3, §6)
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.createTable("saga_player_seasons", {
    player_id: {
      type: "uuid",
      notNull: true,
      references: "users(user_id)",
      onDelete: "CASCADE",
    },
    season_id: {
      type: "varchar(64)",
      notNull: true,
      references: "saga_seasons(season_id)",
      onDelete: "CASCADE",
    },
    currency_balance: {
      type: "integer",
      notNull: true,
      default: 0,
    },
    purchased_item_ids: {
      type: "jsonb",
      notNull: true,
      default: "[]",
    },
    floor_bonuses_claimed: {
      type: "jsonb",
      notNull: true,
      default: "[]",
      comment: "Floor numbers that received first-clear bonus this season",
    },
    full_run_bonus_claimed: {
      type: "boolean",
      notNull: true,
      default: false,
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  pgm.addConstraint("saga_player_seasons", "saga_player_seasons_pkey", {
    primaryKey: ["player_id", "season_id"],
  });

  pgm.addColumn("saga_runs", {
    pending_node_reward: {
      type: "jsonb",
      notNull: false,
      comment:
        "In-progress reward for current node: card pick or post-battle buff",
    },
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropColumn("saga_runs", "pending_node_reward", { ifExists: true });
  pgm.dropTable("saga_player_seasons", { ifExists: true });
};
