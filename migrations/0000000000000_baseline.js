/**
 * CONSOLIDATED BASELINE MIGRATION
 * This migration creates the complete initial schema for fresh installations.
 * It consolidates all the functionality from the individual migrations including:
 * - User card power-ups functionality (previously 1760897872806_add-user-card-power-ups)
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
  pgm.createType("trigger_moment", ["OnPlace", "OnFlip", "OnFlipped", "OnTurnStart", "OnTurnEnd", "AnyOnFlip", "OnDefend", "AnyOnDefend", "HandOnFlip", "BoardOnFlip", "HandOnPlace", "BoardOnPlace", "BeforeCombat", "AfterCombat"]);
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

  // Create user_card_power_ups table
  pgm.createTable("user_card_power_ups", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("uuid_generate_v4()"),
    },
    user_card_instance_id: {
      type: "uuid",
      notNull: true,
      references: "user_owned_cards(user_card_instance_id)",
      onDelete: "CASCADE",
      unique: true, // One power up record per card instance
    },
    power_up_count: {
      type: "integer",
      notNull: true,
      default: 0,
      check: "power_up_count >= 0",
    },
    power_up_data: {
      type: "jsonb",
      notNull: true,
      default: '{"top": 0, "bottom": 0, "left": 0, "right": 0}',
    },
    created_at: {
      type: "timestamp with time zone",
      notNull: true,
      default: pgm.func("now()"),
    },
    updated_at: {
      type: "timestamp with time zone",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

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

  // Create pack_opening_history table
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

  // Create user_card_xp_pools table
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

  // Add primary key constraint for user_card_xp_pools
  pgm.addConstraint("user_card_xp_pools", "pk_user_card_xp_pools", {
    primaryKey: ["user_id", "card_name"],
  });

  // Create xp_transfers table
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

  // Create friendships table
  pgm.createTable("friendships", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("uuid_generate_v4()"),
    },
    requester_id: {
      type: "uuid",
      notNull: true,
      references: "users(user_id)",
      onDelete: "CASCADE",
    },
    addressee_id: {
      type: "uuid",
      notNull: true,
      references: "users(user_id)",
      onDelete: "CASCADE",
    },
    status: {
      type: "varchar(20)",
      notNull: true,
      default: "pending",
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

  // Create user_rankings table for leaderboard system
  pgm.createTable("user_rankings", {
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
    },
    season: {
      type: "varchar(20)",
      notNull: true,
      default: "2024-Q1",
    },
    rating: {
      type: "integer",
      notNull: true,
      default: 1000,
    },
    peak_rating: {
      type: "integer",
      notNull: true,
      default: 1000,
    },
    wins: {
      type: "integer",
      notNull: true,
      default: 0,
    },
    losses: {
      type: "integer",
      notNull: true,
      default: 0,
    },
    draws: {
      type: "integer",
      notNull: true,
      default: 0,
    },
    current_rank: {
      type: "integer",
      default: null,
    },
    peak_rank: {
      type: "integer",
      default: null,
    },
    rank_tier: {
      type: "varchar(20)",
      default: "Bronze",
    },
    last_game_at: {
      type: "timestamp",
      default: null,
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

  // Create game_results table for detailed match history
  pgm.createTable("game_results", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("uuid_generate_v4()"),
    },
    game_id: {
      type: "uuid",
      notNull: true,
      references: "games(game_id)",
      onDelete: "CASCADE",
    },
    player1_id: {
      type: "uuid",
      notNull: true,
      references: "users(user_id)",
      onDelete: "CASCADE",
    },
    player2_id: {
      type: "uuid",
      notNull: true,
      references: "users(user_id)",
      onDelete: "CASCADE",
    },
    winner_id: {
      type: "uuid",
      references: "users(user_id)",
      onDelete: "SET NULL",
    },
    game_mode: {
      type: "varchar(20)",
      notNull: true,
    },
    game_duration_seconds: {
      type: "integer",
      default: 0,
    },
    player1_rating_before: {
      type: "integer",
      notNull: true,
    },
    player1_rating_after: {
      type: "integer",
      notNull: true,
    },
    player2_rating_before: {
      type: "integer",
      notNull: true,
    },
    player2_rating_after: {
      type: "integer",
      notNull: true,
    },
    rating_change: {
      type: "integer",
      notNull: true,
    },
    season: {
      type: "varchar(20)",
      notNull: true,
    },
    completed_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  // Create achievements table for defining all available achievements
  pgm.createTable("achievements", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("uuid_generate_v4()"),
    },
    achievement_key: {
      type: "varchar(100)",
      notNull: true,
      unique: true,
    },
    title: {
      type: "varchar(200)",
      notNull: true,
    },
    description: {
      type: "text",
      notNull: true,
    },
    category: {
      type: "varchar(50)",
      notNull: true,
    },
    type: {
      type: "varchar(20)",
      notNull: true,
      default: "single",
    },
    target_value: {
      type: "integer",
      default: 1,
    },
    rarity: {
      type: "varchar(20)",
      notNull: true,
      default: "common",
    },
    reward_gold: {
      type: "integer",
      default: 0,
    },
    reward_gems: {
      type: "integer",
      default: 0,
    },
    reward_packs: {
      type: "integer",
      default: 0,
    },
    icon_url: {
      type: "varchar(500)",
      default: null,
    },
    is_active: {
      type: "boolean",
      notNull: true,
      default: true,
    },
    sort_order: {
      type: "integer",
      default: 0,
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

  // Create user_achievements table for tracking user progress
  pgm.createTable("user_achievements", {
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
    },
    achievement_id: {
      type: "uuid",
      notNull: true,
      references: "achievements(id)",
      onDelete: "CASCADE",
    },
    current_progress: {
      type: "integer",
      notNull: true,
      default: 0,
    },
    is_completed: {
      type: "boolean",
      notNull: true,
      default: false,
    },
    completed_at: {
      type: "timestamp",
      default: null,
    },
    claimed_at: {
      type: "timestamp",
      default: null,
    },
    is_claimed: {
      type: "boolean",
      notNull: true,
      default: false,
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

  // Create mail table for user inbox system
  pgm.createTable("mail", {
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
    },
    mail_type: {
      type: "varchar(50)",
      notNull: true,
      default: "system",
    },
    subject: {
      type: "varchar(255)",
      notNull: true,
    },
    content: {
      type: "text",
      notNull: true,
    },
    sender_id: {
      type: "uuid",
      references: "users(user_id)",
      onDelete: "SET NULL",
    },
    sender_name: {
      type: "varchar(100)",
      notNull: true,
      default: "System",
    },
    is_read: {
      type: "boolean",
      notNull: true,
      default: false,
    },
    is_claimed: {
      type: "boolean",
      notNull: true,
      default: false,
    },
    has_rewards: {
      type: "boolean",
      notNull: true,
      default: false,
    },
    reward_gold: {
      type: "integer",
      notNull: true,
      default: 0,
    },
    reward_gems: {
      type: "integer",
      notNull: true,
      default: 0,
    },
    reward_packs: {
      type: "integer",
      notNull: true,
      default: 0,
    },
    reward_fate_coins: {
      type: "integer",
      notNull: true,
      default: 0,
    },
    reward_card_ids: {
      type: "text[]",
      notNull: true,
      default: pgm.func("ARRAY[]::text[]"),
    },
    expires_at: {
      type: "timestamp with time zone",
    },
    read_at: {
      type: "timestamp with time zone",
    },
    claimed_at: {
      type: "timestamp with time zone",
    },
    created_at: {
      type: "timestamp with time zone",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
    updated_at: {
      type: "timestamp with time zone",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  // Create fate_picks table for available fate pick opportunities
  pgm.createTable("fate_picks", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("uuid_generate_v4()"),
    },
    pack_opening_id: {
      type: "uuid",
      notNull: true,
    },
    original_owner_id: {
      type: "uuid",
      notNull: true,
      references: "users(user_id)",
      onDelete: "CASCADE",
    },
    original_cards: {
      type: "jsonb",
      notNull: true,
      comment: "Array of card objects in original order [card1, card2, card3, card4, card5]",
    },
    set_id: {
      type: "uuid",
      notNull: true,
      references: "sets(set_id)",
      onDelete: "CASCADE",
    },
    cost_fate_coins: {
      type: "integer",
      notNull: true,
      default: 1,
    },
    max_participants: {
      type: "integer",
      notNull: true,
      default: 10,
    },
    current_participants: {
      type: "integer",
      notNull: true,
      default: 0,
    },
    expires_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp + INTERVAL '24 hours'"),
    },
    is_active: {
      type: "boolean",
      notNull: true,
      default: true,
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

  // Create fate_pick_participations table for tracking user participations
  pgm.createTable("fate_pick_participations", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("uuid_generate_v4()"),
    },
    fate_pick_id: {
      type: "uuid",
      notNull: true,
      references: "fate_picks(id)",
      onDelete: "CASCADE",
    },
    participant_id: {
      type: "uuid",
      notNull: true,
      references: "users(user_id)",
      onDelete: "CASCADE",
    },
    shuffled_positions: {
      type: "jsonb",
      notNull: true,
      comment: "Array mapping display positions to actual card indices [2, 0, 4, 1, 3]",
    },
    selected_position: {
      type: "integer",
      default: null,
      comment: "Position selected by user (0-4), null if not selected yet",
    },
    won_card: {
      type: "jsonb",
      default: null,
      comment: "Card object won by the user, null if not selected yet",
    },
    cost_paid: {
      type: "integer",
      notNull: true,
      comment: "Fate coins paid for this participation",
    },
    status: {
      type: "varchar(20)",
      notNull: true,
      default: "shuffled",
      comment: "shuffled, selected, expired",
    },
    participated_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
    selected_at: {
      type: "timestamp",
      default: null,
    },
    expires_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp + INTERVAL '30 minutes'"),
      comment: "User has 30 minutes to make selection after shuffling",
    },
  });

  // Add constraints
  pgm.addConstraint("friendships", "friendships_status_check", {
    check: "status IN ('pending', 'accepted', 'rejected', 'blocked')",
  });
  pgm.addConstraint("friendships", "friendships_no_self_friend", {
    check: "requester_id != addressee_id",
  });

  pgm.addConstraint("user_rankings", "user_rankings_rating_check", {
    check: "rating >= 0 AND rating <= 3000",
  });
  pgm.addConstraint("user_rankings", "user_rankings_peak_rating_check", {
    check: "peak_rating >= rating",
  });
  pgm.addConstraint("user_rankings", "user_rankings_wins_check", {
    check: "wins >= 0",
  });
  pgm.addConstraint("user_rankings", "user_rankings_losses_check", {
    check: "losses >= 0",
  });
  pgm.addConstraint("user_rankings", "user_rankings_draws_check", {
    check: "draws >= 0",
  });
  pgm.addConstraint("user_rankings", "user_rankings_tier_check", {
    check: "rank_tier IN ('Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Grandmaster')",
  });

  pgm.addConstraint("achievements", "achievements_category_check", {
    check: "category IN ('gameplay', 'collection', 'social', 'progression', 'special')",
  });
  pgm.addConstraint("achievements", "achievements_type_check", {
    check: "type IN ('single', 'progress', 'milestone')",
  });
  pgm.addConstraint("achievements", "achievements_rarity_check", {
    check: "rarity IN ('common', 'uncommon', 'rare', 'epic', 'legendary')",
  });
  pgm.addConstraint("achievements", "achievements_target_value_check", {
    check: "target_value > 0",
  });

  pgm.addConstraint("mail", "mail_type_check", {
    check: "mail_type IN ('system', 'achievement', 'friend', 'admin', 'event', 'welcome', 'reward')",
  });
  pgm.addConstraint("mail", "reward_gold_check", {
    check: "reward_gold >= 0",
  });
  pgm.addConstraint("mail", "reward_gems_check", {
    check: "reward_gems >= 0",
  });
  pgm.addConstraint("mail", "reward_packs_check", {
    check: "reward_packs >= 0",
  });
  pgm.addConstraint("mail", "reward_fate_coins_check", {
    check: "reward_fate_coins >= 0",
  });
  pgm.addConstraint("mail", "has_rewards_consistency_check", {
    check: `
      (has_rewards = false AND reward_gold = 0 AND reward_gems = 0 AND reward_packs = 0 AND reward_fate_coins = 0 AND array_length(reward_card_ids, 1) IS NULL) OR
      (has_rewards = true AND (reward_gold > 0 OR reward_gems > 0 OR reward_packs > 0 OR reward_fate_coins > 0 OR array_length(reward_card_ids, 1) > 0))
    `,
  });

  pgm.addConstraint("fate_picks", "fate_picks_cost_check", {
    check: "cost_fate_coins > 0",
  });
  pgm.addConstraint("fate_picks", "fate_picks_participants_check", {
    check: "current_participants >= 0 AND current_participants <= max_participants",
  });

  pgm.addConstraint("fate_pick_participations", "fate_pick_participations_status_check", {
    check: "status IN ('shuffled', 'selected', 'expired')",
  });
  pgm.addConstraint("fate_pick_participations", "fate_pick_participations_position_check", {
    check: "selected_position IS NULL OR (selected_position >= 0 AND selected_position <= 4)",
  });
  pgm.addConstraint("fate_pick_participations", "fate_pick_participations_cost_check", {
    check: "cost_paid > 0",
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
  
  // User card power ups indexes
  pgm.createIndex("user_card_power_ups", "user_card_instance_id");
  
  pgm.createIndex("decks", "user_id");
  pgm.createIndex("deck_cards", "deck_id");
  pgm.createIndex("deck_cards", "user_card_instance_id");
  
  pgm.createIndex("games", "player1_id");
  pgm.createIndex("games", "player2_id");
  pgm.createIndex("games", "winner_id");
  pgm.createIndex("games", "game_status");
  pgm.createIndex("games", "created_at");

  // Pack opening history indexes
  pgm.createIndex("pack_opening_history", "user_id");
  pgm.createIndex("pack_opening_history", "set_id");
  pgm.createIndex("pack_opening_history", "opened_at");

  // User card XP pools indexes
  pgm.createIndex("user_card_xp_pools", "user_id");
  pgm.createIndex("user_card_xp_pools", "card_name");
  pgm.createIndex("user_card_xp_pools", ["user_id", "card_name"]);

  // XP transfers indexes
  pgm.createIndex("xp_transfers", "user_id");
  pgm.createIndex("xp_transfers", "transfer_type");
  pgm.createIndex("xp_transfers", "card_name");
  pgm.createIndex("xp_transfers", "target_card_id");
  pgm.createIndex("xp_transfers", "created_at");

  // Friendships indexes
  pgm.createIndex("friendships", "requester_id");
  pgm.createIndex("friendships", "addressee_id");
  pgm.createIndex("friendships", "status");
  pgm.createIndex("friendships", ["requester_id", "status"]);
  pgm.createIndex("friendships", ["addressee_id", "status"]);

  // User rankings indexes
  pgm.createIndex("user_rankings", ["season", "rating"], { name: "user_rankings_season_rating_idx" });
  pgm.createIndex("user_rankings", ["season", "current_rank"], { name: "user_rankings_season_rank_idx" });
  pgm.createIndex("user_rankings", "rank_tier");
  pgm.createIndex("user_rankings", "last_game_at");

  // Game results indexes
  pgm.createIndex("game_results", "game_id", { unique: true });
  pgm.createIndex("game_results", ["player1_id", "completed_at"]);
  pgm.createIndex("game_results", ["player2_id", "completed_at"]);
  pgm.createIndex("game_results", ["season", "completed_at"]);
  pgm.createIndex("game_results", "winner_id");

  // Achievements indexes
  pgm.createIndex("achievements", "category");
  pgm.createIndex("achievements", "type");
  pgm.createIndex("achievements", "rarity");
  pgm.createIndex("achievements", ["is_active", "sort_order"]);

  // User achievements indexes
  pgm.createIndex("user_achievements", "user_id");
  pgm.createIndex("user_achievements", "achievement_id");
  pgm.createIndex("user_achievements", ["user_id", "is_completed"]);
  pgm.createIndex("user_achievements", ["user_id", "is_claimed"]);

  // Mail indexes
  pgm.createIndex("mail", "user_id");
  pgm.createIndex("mail", "mail_type");
  pgm.createIndex("mail", "is_read");
  pgm.createIndex("mail", "has_rewards");
  pgm.createIndex("mail", "is_claimed");
  pgm.createIndex("mail", "expires_at");
  pgm.createIndex("mail", "created_at");
  pgm.createIndex("mail", ["user_id", "is_read"]);
  pgm.createIndex("mail", ["user_id", "has_rewards", "is_claimed"]);

  // Fate picks indexes
  pgm.createIndex("fate_picks", "original_owner_id");
  pgm.createIndex("fate_picks", "set_id");
  pgm.createIndex("fate_picks", ["is_active", "expires_at"]);
  pgm.createIndex("fate_picks", "created_at");

  // Fate pick participations indexes
  pgm.createIndex("fate_pick_participations", "fate_pick_id");
  pgm.createIndex("fate_pick_participations", "participant_id");
  pgm.createIndex("fate_pick_participations", ["status", "expires_at"]);

  // Add unique constraints
  pgm.addConstraint("decks", "unique_user_deck_name", {
    unique: ["user_id", "name"],
  });
  
  pgm.addConstraint("deck_cards", "unique_card_in_deck", {
    unique: ["deck_id", "user_card_instance_id"],
  });

  // Friendships unique constraints
  pgm.createIndex("friendships", ["requester_id", "addressee_id"], {
    unique: true,
    name: "friendships_unique_pair",
  });

  // User rankings unique constraints
  pgm.createIndex("user_rankings", ["user_id", "season"], {
    unique: true,
    name: "user_rankings_user_season_unique",
  });

  // User achievements unique constraints
  pgm.createIndex("user_achievements", ["user_id", "achievement_id"], {
    unique: true,
    name: "user_achievements_user_achievement_unique",
  });

  // Fate pick participations unique constraints
  pgm.createIndex("fate_pick_participations", ["fate_pick_id", "participant_id"], {
    unique: true,
    name: "fate_pick_participations_unique_per_pick",
  });

  // Create database functions and triggers
  
  // Function to prevent bidirectional friendships
  pgm.sql(`
    CREATE OR REPLACE FUNCTION prevent_duplicate_friendships()
    RETURNS TRIGGER AS $$
    BEGIN
      -- Check if there's already a friendship request in either direction
      IF EXISTS (
        SELECT 1 FROM friendships 
        WHERE (requester_id = NEW.requester_id AND addressee_id = NEW.addressee_id)
           OR (requester_id = NEW.addressee_id AND addressee_id = NEW.requester_id)
      ) THEN
        RAISE EXCEPTION 'Friendship already exists between these users';
      END IF;
      
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.sql(`
    CREATE TRIGGER prevent_duplicate_friendships_trigger
    BEFORE INSERT ON friendships
    FOR EACH ROW
    EXECUTE FUNCTION prevent_duplicate_friendships();
  `);

  // Function to update friendship updated_at timestamp
  pgm.sql(`
    CREATE OR REPLACE FUNCTION update_friendship_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = current_timestamp;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.sql(`
    CREATE TRIGGER update_friendship_updated_at_trigger
    BEFORE UPDATE ON friendships
    FOR EACH ROW
    EXECUTE FUNCTION update_friendship_updated_at();
  `);

  // Function to update user rankings updated_at timestamp
  pgm.sql(`
    CREATE OR REPLACE FUNCTION update_user_rankings_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = current_timestamp;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.sql(`
    CREATE TRIGGER update_user_rankings_updated_at_trigger
    BEFORE UPDATE ON user_rankings
    FOR EACH ROW
    EXECUTE FUNCTION update_user_rankings_updated_at();
  `);

  // Function to calculate rank tier based on rating
  pgm.sql(`
    CREATE OR REPLACE FUNCTION calculate_rank_tier(rating_value INTEGER)
    RETURNS VARCHAR(20) AS $$
    BEGIN
      CASE
        WHEN rating_value >= 2500 THEN RETURN 'Grandmaster';
        WHEN rating_value >= 2200 THEN RETURN 'Master';
        WHEN rating_value >= 1900 THEN RETURN 'Diamond';
        WHEN rating_value >= 1600 THEN RETURN 'Platinum';
        WHEN rating_value >= 1300 THEN RETURN 'Gold';
        WHEN rating_value >= 1000 THEN RETURN 'Silver';
        ELSE RETURN 'Bronze';
      END CASE;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Function to auto-update rank tier when rating changes
  pgm.sql(`
    CREATE OR REPLACE FUNCTION update_rank_tier()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.rank_tier = calculate_rank_tier(NEW.rating);
      IF NEW.rating > NEW.peak_rating THEN
        NEW.peak_rating = NEW.rating;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.sql(`
    CREATE TRIGGER update_rank_tier_trigger
    BEFORE INSERT OR UPDATE ON user_rankings
    FOR EACH ROW
    EXECUTE FUNCTION update_rank_tier();
  `);

  // Function to update user_achievements updated_at timestamp
  pgm.sql(`
    CREATE OR REPLACE FUNCTION update_user_achievements_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = current_timestamp;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.sql(`
    CREATE TRIGGER update_user_achievements_updated_at_trigger
    BEFORE UPDATE ON user_achievements
    FOR EACH ROW
    EXECUTE FUNCTION update_user_achievements_updated_at();
  `);

  // Function to update achievements updated_at timestamp
  pgm.sql(`
    CREATE OR REPLACE FUNCTION update_achievements_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = current_timestamp;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.sql(`
    CREATE TRIGGER update_achievements_updated_at_trigger
    BEFORE UPDATE ON achievements
    FOR EACH ROW
    EXECUTE FUNCTION update_achievements_updated_at();
  `);

  // Function to automatically set completion timestamp
  pgm.sql(`
    CREATE OR REPLACE FUNCTION auto_set_achievement_completion()
    RETURNS TRIGGER AS $$
    BEGIN
      -- If achievement is being marked as completed for the first time
      IF NEW.is_completed = true AND OLD.is_completed = false THEN
        NEW.completed_at = current_timestamp;
      END IF;
      
      -- If achievement is being claimed for the first time
      IF NEW.is_claimed = true AND OLD.is_claimed = false THEN
        NEW.claimed_at = current_timestamp;
      END IF;
      
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.sql(`
    CREATE TRIGGER auto_set_achievement_completion_trigger
    BEFORE UPDATE ON user_achievements
    FOR EACH ROW
    EXECUTE FUNCTION auto_set_achievement_completion();
  `);

  // Mail system functions and triggers
  pgm.sql(`
    CREATE OR REPLACE FUNCTION update_mail_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = current_timestamp;
      RETURN NEW;
    END;
    $$ language 'plpgsql';
  `);

  pgm.sql(`
    CREATE TRIGGER update_mail_updated_at_trigger
    BEFORE UPDATE ON mail
    FOR EACH ROW
    EXECUTE FUNCTION update_mail_updated_at();
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION set_mail_read_at()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.is_read = true AND OLD.is_read = false THEN
        NEW.read_at = current_timestamp;
      END IF;
      RETURN NEW;
    END;
    $$ language 'plpgsql';
  `);

  pgm.sql(`
    CREATE TRIGGER set_mail_read_at_trigger
    BEFORE UPDATE ON mail
    FOR EACH ROW
    EXECUTE FUNCTION set_mail_read_at();
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION set_mail_claimed_at()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.is_claimed = true AND OLD.is_claimed = false THEN
        NEW.claimed_at = current_timestamp;
      END IF;
      RETURN NEW;
    END;
    $$ language 'plpgsql';
  `);

  pgm.sql(`
    CREATE TRIGGER set_mail_claimed_at_trigger
    BEFORE UPDATE ON mail
    FOR EACH ROW
    EXECUTE FUNCTION set_mail_claimed_at();
  `);

  // Function to get user mail statistics
  pgm.sql(`
    CREATE OR REPLACE FUNCTION get_user_mail_stats(p_user_id UUID)
    RETURNS TABLE (
      total_mail INTEGER,
      unread_mail INTEGER,
      unclaimed_rewards INTEGER,
      expired_mail INTEGER
    ) AS $$
    BEGIN
      RETURN QUERY
      SELECT 
        COUNT(*)::INTEGER as total_mail,
        COUNT(CASE WHEN is_read = false THEN 1 END)::INTEGER as unread_mail,
        COUNT(CASE WHEN has_rewards = true AND is_claimed = false AND (expires_at IS NULL OR expires_at > current_timestamp) THEN 1 END)::INTEGER as unclaimed_rewards,
        COUNT(CASE WHEN expires_at IS NOT NULL AND expires_at <= current_timestamp THEN 1 END)::INTEGER as expired_mail
      FROM mail
      WHERE user_id = p_user_id;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Function to clean up old expired mail
  pgm.sql(`
    CREATE OR REPLACE FUNCTION cleanup_expired_mail()
    RETURNS INTEGER AS $$
    DECLARE
      deleted_count INTEGER;
    BEGIN
      DELETE FROM mail 
      WHERE expires_at IS NOT NULL 
        AND expires_at < current_timestamp - INTERVAL '30 days'
        AND (is_claimed = true OR has_rewards = false);
      
      GET DIAGNOSTICS deleted_count = ROW_COUNT;
      RETURN deleted_count;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Fate picks functions and triggers
  pgm.sql(`
    CREATE OR REPLACE FUNCTION update_fate_picks_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = current_timestamp;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.sql(`
    CREATE TRIGGER update_fate_picks_updated_at_trigger
    BEFORE UPDATE ON fate_picks
    FOR EACH ROW
    EXECUTE FUNCTION update_fate_picks_updated_at();
  `);

  // Function to auto-expire fate picks and participations
  pgm.sql(`
    CREATE OR REPLACE FUNCTION cleanup_expired_fate_picks()
    RETURNS void AS $$
    BEGIN
      -- Expire participations that haven't been selected in time
      UPDATE fate_pick_participations 
      SET status = 'expired' 
      WHERE status = 'shuffled' 
        AND expires_at < current_timestamp;
      
      -- Deactivate expired fate picks
      UPDATE fate_picks 
      SET is_active = false 
      WHERE is_active = true 
        AND expires_at < current_timestamp;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Trigger to update participant count when participations are added
  pgm.sql(`
    CREATE OR REPLACE FUNCTION update_fate_pick_participant_count()
    RETURNS TRIGGER AS $$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        UPDATE fate_picks 
        SET current_participants = current_participants + 1 
        WHERE id = NEW.fate_pick_id;
        RETURN NEW;
      ELSIF TG_OP = 'DELETE' THEN
        UPDATE fate_picks 
        SET current_participants = current_participants - 1 
        WHERE id = OLD.fate_pick_id;
        RETURN OLD;
      END IF;
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.sql(`
    CREATE TRIGGER update_fate_pick_participant_count_trigger
    AFTER INSERT OR DELETE ON fate_pick_participations
    FOR EACH ROW
    EXECUTE FUNCTION update_fate_pick_participant_count();
  `);

  // User card power ups trigger and function
  pgm.sql(`
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
        NEW.updated_at = now();
        RETURN NEW;
    END;
    $$ language 'plpgsql';
  `);

  pgm.sql(`
    CREATE TRIGGER update_user_card_power_ups_updated_at
    BEFORE UPDATE ON user_card_power_ups
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);

  // Insert starter achievements
  pgm.sql(`
    INSERT INTO achievements (achievement_key, title, description, category, type, target_value, rarity, reward_gold, reward_gems, sort_order) VALUES
    -- Gameplay Achievements
    ('first_victory', 'First Victory', 'Win your first game', 'gameplay', 'single', 1, 'common', 100, 1, 1),
    ('solo_master', 'Solo Master', 'Win 10 solo games', 'gameplay', 'progress', 10, 'uncommon', 250, 2, 2),
    ('pvp_warrior', 'PvP Warrior', 'Win 5 multiplayer games', 'gameplay', 'progress', 5, 'uncommon', 300, 3, 3),
    ('win_streak_5', '5-Game Win Streak', 'Win 5 games in a row', 'gameplay', 'single', 5, 'rare', 500, 5, 4),
    ('perfect_game', 'Perfect Game', 'Win a game without losing any cards', 'gameplay', 'single', 1, 'epic', 750, 10, 5),
    
    -- Collection Achievements
    ('first_pack', 'Pack Opener', 'Open your first pack', 'collection', 'single', 1, 'common', 50, 0, 10),
    ('pack_addict', 'Pack Addict', 'Open 50 packs', 'collection', 'progress', 50, 'rare', 1000, 15, 11),
    ('rare_collector', 'Rare Collector', 'Collect 10 rare cards', 'collection', 'progress', 10, 'uncommon', 300, 3, 12),
    ('legendary_hunter', 'Legendary Hunter', 'Collect your first legendary card', 'collection', 'single', 1, 'epic', 1000, 20, 13),
    ('card_master', 'Card Master', 'Collect 100 different cards', 'collection', 'milestone', 100, 'legendary', 2000, 50, 14),
    
    -- Progression Achievements
    ('level_up', 'Level Up', 'Level up your first card', 'progression', 'single', 1, 'common', 75, 1, 20),
    ('max_level', 'Max Level', 'Get a card to maximum level (10)', 'progression', 'single', 1, 'rare', 500, 8, 21),
    ('xp_master', 'XP Master', 'Transfer XP between cards 25 times', 'progression', 'progress', 25, 'uncommon', 400, 5, 22),
    ('sacrifice_master', 'Sacrifice Master', 'Sacrifice 20 cards for XP', 'progression', 'progress', 20, 'uncommon', 350, 4, 23),
    
    -- Social Achievements
    ('social_butterfly', 'Social Butterfly', 'Add your first friend', 'social', 'single', 1, 'common', 100, 2, 30),
    ('friend_collector', 'Friend Collector', 'Have 10 friends', 'social', 'progress', 10, 'uncommon', 300, 5, 31),
    ('challenger', 'Challenger', 'Challenge a friend to 5 games', 'social', 'progress', 5, 'uncommon', 250, 3, 32),
    
    -- Special Achievements
    ('early_adopter', 'Early Adopter', 'Join during the beta period', 'special', 'single', 1, 'legendary', 1500, 25, 40),
    ('beta_tester', 'Beta Tester', 'Play 100 games during beta', 'special', 'progress', 100, 'epic', 1000, 15, 41),
    ('completionist', 'Completionist', 'Complete 50 achievements', 'special', 'milestone', 50, 'legendary', 5000, 100, 42);
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Drop triggers first
  pgm.sql("DROP TRIGGER IF EXISTS update_user_card_power_ups_updated_at ON user_card_power_ups;");
  pgm.sql("DROP TRIGGER IF EXISTS update_fate_pick_participant_count_trigger ON fate_pick_participations;");
  pgm.sql("DROP TRIGGER IF EXISTS update_fate_picks_updated_at_trigger ON fate_picks;");
  pgm.sql("DROP TRIGGER IF EXISTS set_mail_claimed_at_trigger ON mail;");
  pgm.sql("DROP TRIGGER IF EXISTS set_mail_read_at_trigger ON mail;");
  pgm.sql("DROP TRIGGER IF EXISTS update_mail_updated_at_trigger ON mail;");
  pgm.sql("DROP TRIGGER IF EXISTS auto_set_achievement_completion_trigger ON user_achievements;");
  pgm.sql("DROP TRIGGER IF EXISTS update_achievements_updated_at_trigger ON achievements;");
  pgm.sql("DROP TRIGGER IF EXISTS update_user_achievements_updated_at_trigger ON user_achievements;");
  pgm.sql("DROP TRIGGER IF EXISTS update_rank_tier_trigger ON user_rankings;");
  pgm.sql("DROP TRIGGER IF EXISTS update_user_rankings_updated_at_trigger ON user_rankings;");
  pgm.sql("DROP TRIGGER IF EXISTS update_friendship_updated_at_trigger ON friendships;");
  pgm.sql("DROP TRIGGER IF EXISTS prevent_duplicate_friendships_trigger ON friendships;");

  // Drop functions
  pgm.sql("DROP FUNCTION IF EXISTS update_updated_at_column();");
  pgm.sql("DROP FUNCTION IF EXISTS update_fate_pick_participant_count();");
  pgm.sql("DROP FUNCTION IF EXISTS cleanup_expired_fate_picks();");
  pgm.sql("DROP FUNCTION IF EXISTS update_fate_picks_updated_at();");
  pgm.sql("DROP FUNCTION IF EXISTS cleanup_expired_mail();");
  pgm.sql("DROP FUNCTION IF EXISTS get_user_mail_stats(UUID);");
  pgm.sql("DROP FUNCTION IF EXISTS set_mail_claimed_at();");
  pgm.sql("DROP FUNCTION IF EXISTS set_mail_read_at();");
  pgm.sql("DROP FUNCTION IF EXISTS update_mail_updated_at();");
  pgm.sql("DROP FUNCTION IF EXISTS auto_set_achievement_completion();");
  pgm.sql("DROP FUNCTION IF EXISTS update_achievements_updated_at();");
  pgm.sql("DROP FUNCTION IF EXISTS update_user_achievements_updated_at();");
  pgm.sql("DROP FUNCTION IF EXISTS update_rank_tier();");
  pgm.sql("DROP FUNCTION IF EXISTS calculate_rank_tier(INTEGER);");
  pgm.sql("DROP FUNCTION IF EXISTS update_user_rankings_updated_at();");
  pgm.sql("DROP FUNCTION IF EXISTS update_friendship_updated_at();");
  pgm.sql("DROP FUNCTION IF EXISTS prevent_duplicate_friendships();");

  // Drop tables in reverse order
  pgm.dropTable("fate_pick_participations");
  pgm.dropTable("fate_picks");
  pgm.dropTable("mail");
  pgm.dropTable("user_achievements");
  pgm.dropTable("achievements");
  pgm.dropTable("game_results");
  pgm.dropTable("user_rankings");
  pgm.dropTable("friendships");
  pgm.dropTable("xp_transfers");
  pgm.dropTable("user_card_xp_pools");
  pgm.dropTable("pack_opening_history");
  pgm.dropTable("games");
  pgm.dropTable("deck_cards");
  pgm.dropTable("decks");
  pgm.dropTable("user_card_power_ups");
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