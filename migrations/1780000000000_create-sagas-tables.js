/**
 * Sagas roguelike mode — core data model (GDD Section 10)
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.createType("saga_run_status", ["active", "completed", "abandoned"]);
  pgm.createType("saga_rune_type", ["fury", "slayer"]);

  pgm.createTable("saga_seasons", {
    season_id: {
      type: "varchar(64)",
      primaryKey: true,
      comment: 'Unique season identifier (e.g. "ragnarok_s1")',
    },
    season_name: {
      type: "varchar(128)",
      notNull: true,
    },
    start_date: {
      type: "timestamptz",
      notNull: true,
    },
    end_date: {
      type: "timestamptz",
      notNull: true,
    },
    seasonal_mechanic: {
      type: "jsonb",
      notNull: true,
      default: "{}",
    },
    legendary_anchors: {
      type: "jsonb",
      notNull: true,
      default: "[]",
    },
    enemy_decks: {
      type: "jsonb",
      notNull: true,
      default: "{}",
    },
    boss_configs: {
      type: "jsonb",
      notNull: true,
      default: "{}",
    },
    shop_items: {
      type: "jsonb",
      notNull: true,
      default: "[]",
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

  pgm.createIndex("saga_seasons", ["start_date", "end_date"], {
    name: "idx_saga_seasons_active_window",
  });

  pgm.createTable("saga_runs", {
    run_id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("uuid_generate_v4()"),
    },
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
      onDelete: "RESTRICT",
    },
    status: {
      type: "saga_run_status",
      notNull: true,
      default: "active",
    },
    current_floor: {
      type: "integer",
      notNull: true,
      default: 1,
    },
    current_node: {
      type: "varchar(64)",
      notNull: false,
    },
    node_map: {
      type: "jsonb",
      notNull: true,
      default: "{}",
    },
    currency_earned: {
      type: "integer",
      notNull: true,
      default: 0,
      comment: "Cumulative currency across all attempts this season",
    },
    run_currency: {
      type: "integer",
      notNull: true,
      default: 0,
      comment: "Currency earned on this specific run attempt",
    },
    attempt_count: {
      type: "integer",
      notNull: true,
      default: 1,
    },
    completed_at: {
      type: "timestamptz",
      notNull: false,
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

  pgm.createIndex("saga_runs", "player_id", { name: "idx_saga_runs_player_id" });
  pgm.createIndex("saga_runs", "season_id", { name: "idx_saga_runs_season_id" });
  pgm.createIndex("saga_runs", ["player_id", "season_id"], {
    name: "idx_saga_runs_player_season",
  });

  pgm.sql(`
    CREATE UNIQUE INDEX idx_saga_runs_one_active_per_player_season
    ON saga_runs (player_id, season_id)
    WHERE status = 'active';
  `);

  pgm.createTable("saga_decks", {
    deck_id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("uuid_generate_v4()"),
    },
    run_id: {
      type: "uuid",
      notNull: true,
      references: "saga_runs(run_id)",
      onDelete: "CASCADE",
      unique: true,
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

  pgm.createTable("saga_collections", {
    collection_id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("uuid_generate_v4()"),
    },
    run_id: {
      type: "uuid",
      notNull: true,
      references: "saga_runs(run_id)",
      onDelete: "CASCADE",
      unique: true,
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

  pgm.createTable("saga_cards", {
    saga_card_id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("uuid_generate_v4()"),
    },
    run_id: {
      type: "uuid",
      notNull: true,
      references: "saga_runs(run_id)",
      onDelete: "CASCADE",
    },
    deck_id: {
      type: "uuid",
      notNull: false,
      references: "saga_decks(deck_id)",
      onDelete: "SET NULL",
    },
    base_card_id: {
      type: "uuid",
      notNull: true,
      references: "card_variants(card_variant_id)",
      onDelete: "RESTRICT",
      comment: "Reference to base card definition (card_variant)",
    },
    top_buff: { type: "integer", notNull: true, default: 0 },
    left_buff: { type: "integer", notNull: true, default: 0 },
    right_buff: { type: "integer", notNull: true, default: 0 },
    bottom_buff: { type: "integer", notNull: true, default: 0 },
    rune_type: {
      type: "saga_rune_type",
      notNull: false,
    },
    rune_stacks: {
      type: "integer",
      notNull: true,
      default: 0,
    },
    is_active: {
      type: "boolean",
      notNull: true,
      default: true,
      comment: "true = active deck, false = bench (Saga Collection)",
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

  pgm.createIndex("saga_cards", "run_id", { name: "idx_saga_cards_run_id" });
  pgm.createIndex("saga_cards", "deck_id", { name: "idx_saga_cards_deck_id" });
  pgm.createIndex("saga_cards", ["run_id", "is_active"], {
    name: "idx_saga_cards_run_active",
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropTable("saga_cards", { ifExists: true });
  pgm.dropTable("saga_collections", { ifExists: true });
  pgm.dropTable("saga_decks", { ifExists: true });
  pgm.dropTable("saga_runs", { ifExists: true });
  pgm.dropTable("saga_seasons", { ifExists: true });
  pgm.dropType("saga_rune_type", { ifExists: true });
  pgm.dropType("saga_run_status", { ifExists: true });
};
