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
  // Create the user_rankings table for leaderboard system
  pgm.createTable("user_rankings", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
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
      default: pgm.func("NOW()"),
    },
    updated_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("NOW()"),
    },
  });

  // Add constraints
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
    check:
      "rank_tier IN ('Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Grandmaster')",
  });

  // Unique constraint for user per season
  pgm.createIndex("user_rankings", ["user_id", "season"], {
    unique: true,
    name: "user_rankings_user_season_unique",
  });

  // Indexes for efficient leaderboard queries
  pgm.createIndex("user_rankings", ["season", "rating"], {
    name: "user_rankings_season_rating_idx",
  });

  pgm.createIndex("user_rankings", ["season", "current_rank"], {
    name: "user_rankings_season_rank_idx",
  });

  pgm.createIndex("user_rankings", "rank_tier");
  pgm.createIndex("user_rankings", "last_game_at");

  // Create the game_results table for detailed match history
  pgm.createTable("game_results", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    game_id: {
      type: "uuid",
      notNull: true,
      references: "Games(game_id)",
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
      default: pgm.func("NOW()"),
    },
  });

  // Add indexes for game results
  pgm.createIndex("game_results", "game_id", { unique: true });
  pgm.createIndex("game_results", ["player1_id", "completed_at"]);
  pgm.createIndex("game_results", ["player2_id", "completed_at"]);
  pgm.createIndex("game_results", ["season", "completed_at"]);
  pgm.createIndex("game_results", "winner_id");

  // Function to update user rankings updated_at timestamp
  pgm.sql(`
    CREATE OR REPLACE FUNCTION update_user_rankings_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Trigger to automatically update updated_at
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

  // Trigger to automatically update rank tier
  pgm.sql(`
    CREATE TRIGGER update_rank_tier_trigger
    BEFORE INSERT OR UPDATE ON user_rankings
    FOR EACH ROW
    EXECUTE FUNCTION update_rank_tier();
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Drop triggers first
  pgm.sql("DROP TRIGGER IF EXISTS update_rank_tier_trigger ON user_rankings;");
  pgm.sql(
    "DROP TRIGGER IF EXISTS update_user_rankings_updated_at_trigger ON user_rankings;"
  );

  // Drop functions
  pgm.sql("DROP FUNCTION IF EXISTS update_rank_tier();");
  pgm.sql("DROP FUNCTION IF EXISTS calculate_rank_tier(INTEGER);");
  pgm.sql("DROP FUNCTION IF EXISTS update_user_rankings_updated_at();");

  // Drop tables (this will also drop indexes and constraints)
  pgm.dropTable("game_results");
  pgm.dropTable("user_rankings");
};
