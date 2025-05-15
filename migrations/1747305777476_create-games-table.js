/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  // Create custom types for game mode and status
  pgm.createType("game_mode", ["solo", "pvp"]);
  pgm.createType("game_status", ["pending", "active", "completed", "aborted"]);
  pgm.createType("board_layout", ["4x4"]);

  pgm.createTable("games", {
    game_id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("uuid_generate_v4()"),
    },
    player1_id: {
      type: "uuid",
      notNull: true,
      references: "users(user_id)",
      onDelete: "CASCADE",
    },
    player2_id: {
      type: "uuid",
      references: "users(user_id)",
      onDelete: "SET NULL",
    },
    player1_deck_id: {
      type: "uuid",
      notNull: true,
      references: "decks(deck_id)",
      onDelete: "CASCADE",
    },
    player2_deck_id: {
      type: "uuid",
      references: "decks(deck_id)",
      onDelete: "SET NULL",
    },
    game_mode: {
      type: "game_mode",
      notNull: true,
    },
    winner_id: {
      type: "uuid",
      references: "users(user_id)",
      onDelete: "SET NULL",
    },
    game_status: {
      type: "game_status",
      notNull: true,
      default: "pending",
    },
    game_state: {
      type: "jsonb",
      notNull: true,
      default: "{}",
    },
    board_layout: {
      type: "board_layout",
      notNull: true,
      default: "4x4",
    },
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
    completed_at: {
      type: "timestamp",
    },
  });

  // Create indexes for performance
  pgm.createIndex("games", "player1_id");
  pgm.createIndex("games", "player2_id");
  pgm.createIndex("games", "winner_id");
  pgm.createIndex("games", "game_status");
  pgm.createIndex("games", "created_at");
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.dropIndex("games", "created_at");
  pgm.dropIndex("games", "game_status");
  pgm.dropIndex("games", "winner_id");
  pgm.dropIndex("games", "player2_id");
  pgm.dropIndex("games", "player1_id");
  pgm.dropTable("games");
  pgm.dropType("board_layout");
  pgm.dropType("game_status");
  pgm.dropType("game_mode");
};
