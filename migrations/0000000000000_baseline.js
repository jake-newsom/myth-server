/**
 * CONSOLIDATED BASELINE MIGRATION
 * This migration creates the complete initial schema for fresh installations.
 * It consolidates all the functionality from the individual migrations.
 * 
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  // Create extensions
  pgm.createExtension("uuid-ossp", { ifNotExists: true });

  // Create custom enum types
  pgm.createType("card_rarity", ["common", "uncommon", "rare", "epic", "legendary"]);
  pgm.createType("trigger_moment", ["OnPlace", "OnFlip", "OnFlipped", "OnTurnStart", "OnTurnEnd", "OnAnyFlip"]);
  pgm.createType("game_mode", ["solo", "pvp"]);
  pgm.createType("game_status", ["pending", "active", "completed", "aborted"]);
  pgm.createType("board_layout", ["4x4"]);
  pgm.createType("xp_transfer_type", ["card_to_card", "sacrifice_to_pool", "pool_to_card", "game_reward_to_pool"]);

  // Create users table
  pgm.createTable("users", {
    user_id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("uuid_generate_v4()"),
    },
    username: {
      type: "varchar(50)",
      notNull: true,
      unique: true,
    },
    email: {
      type: "varchar(100)",
      notNull: true,
      unique: true,
    },
    password_hash: {
      type: "varchar(100)",
      notNull: true,
    },
    in_game_currency: {
      type: "integer",
      notNull: true,
      default: 0,
    },
    pack_count: {
      type: "integer",
      notNull: true,
      default: 0,
    },
    gold: {
      type: "integer",
      notNull: true,
      default: 0,
    },
    gems: {
      type: "integer",
      notNull: true,
      default: 0,
    },
    total_xp: {
      type: "integer",
      notNull: true,
      default: 0,
    },
    fate_coins: {
      type: "integer",
      notNull: true,
      default: 0,
    },
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
    last_login: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  // Add constraints to users
  pgm.addConstraint("users", "users_pack_count_check", { check: "pack_count >= 0" });
  pgm.addConstraint("users", "users_gold_check", { check: "gold >= 0" });
  pgm.addConstraint("users", "users_gems_check", { check: "gems >= 0" });
  pgm.addConstraint("users", "users_total_xp_check", { check: "total_xp >= 0" });
  pgm.addConstraint("users", "users_fate_coins_check", { check: "fate_coins >= 0" });

  // Create sets table
  pgm.createTable("sets", {
    set_id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("uuid_generate_v4()"),
    },
    name: {
      type: "varchar(100)",
      notNull: true,
      unique: true,
    },
    description: {
      type: "text",
    },
    is_released: {
      type: "boolean",
      notNull: true,
      default: false,
    },
    image_url: {
      type: "varchar(255)",
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

  // Create special_abilities table
  pgm.createTable("special_abilities", {
    ability_id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("uuid_generate_v4()"),
    },
    id: {
      type: "varchar(50)",
      notNull: true,
      unique: true,
    },
    name: {
      type: "varchar(100)",
      notNull: true,
    },
    description: {
      type: "text",
      notNull: true,
    },
    trigger_moment: {
      type: "trigger_moment",
      notNull: true,
    },
    parameters: {
      type: "jsonb",
      notNull: true,
    },
  });

  // Create cards table
  pgm.createTable("cards", {
    card_id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("uuid_generate_v4()"),
    },
    name: {
      type: "varchar(100)",
      notNull: true,
    },
    type: {
      type: "varchar(50)",
      notNull: true,
    },
    rarity: {
      type: "card_rarity",
      notNull: true,
    },
    image_url: {
      type: "varchar(255)",
      notNull: true,
    },
    power: {
      type: "jsonb",
      notNull: true,
    },
    special_ability_id: {
      type: "uuid",
      references: "special_abilities(ability_id)",
      onDelete: "SET NULL",
    },
    tags: {
      type: "text[]",
      notNull: true,
      default: "{}",
    },
    set_id: {
      type: "uuid",
      references: "sets(set_id)",
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
  });

  // Create user_owned_cards table
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
    },
    xp: {
      type: "integer",
      notNull: true,
      default: 0,
    },
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  // Add constraints to user_owned_cards
  pgm.addConstraint("user_owned_cards", "level_check", { check: "level > 0" });
  pgm.addConstraint("user_owned_cards", "xp_check", { check: "xp >= 0" });

  // Create decks table
  pgm.createTable("decks", {
    deck_id: {
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
    name: {
      type: "varchar(50)",
      notNull: true,
    },
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
    last_updated: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  // Create deck_cards table
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

  // Create games table
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

  // Create all indexes
  pgm.createIndex("users", "username");
  pgm.createIndex("users", "email");
  pgm.createIndex("users", "pack_count");
  pgm.createIndex("users", "gold");
  pgm.createIndex("users", "gems");
  
  pgm.createIndex("sets", "name");
  pgm.createIndex("sets", "is_released");
  
  pgm.createIndex("special_abilities", "id");
  
  pgm.createIndex("cards", "name");
  pgm.createIndex("cards", "rarity");
  pgm.createIndex("cards", "special_ability_id");
  pgm.createIndex("cards", "tags", { method: "gin" });
  pgm.createIndex("cards", "set_id");
  
  pgm.createIndex("user_owned_cards", "user_id");
  pgm.createIndex("user_owned_cards", "card_id");
  pgm.createIndex("user_owned_cards", ["user_id", "card_id"]);
  
  pgm.createIndex("decks", "user_id");
  pgm.createIndex("deck_cards", "deck_id");
  pgm.createIndex("deck_cards", "user_card_instance_id");
  
  pgm.createIndex("games", "player1_id");
  pgm.createIndex("games", "player2_id");
  pgm.createIndex("games", "winner_id");
  pgm.createIndex("games", "game_status");
  pgm.createIndex("games", "created_at");

  // Add unique constraints
  pgm.addConstraint("decks", "unique_user_deck_name", {
    unique: ["user_id", "name"],
  });
  
  pgm.addConstraint("deck_cards", "unique_card_in_deck", {
    unique: ["deck_id", "user_card_instance_id"],
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Drop tables in reverse order
  pgm.dropTable("games");
  pgm.dropTable("deck_cards");
  pgm.dropTable("decks");
  pgm.dropTable("user_owned_cards");
  pgm.dropTable("cards");
  pgm.dropTable("special_abilities");
  pgm.dropTable("sets");
  pgm.dropTable("users");
  
  // Drop types
  pgm.dropType("xp_transfer_type");
  pgm.dropType("board_layout");
  pgm.dropType("game_status");
  pgm.dropType("game_mode");
  pgm.dropType("trigger_moment");
  pgm.dropType("card_rarity");
}; 