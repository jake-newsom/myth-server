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
  // Create the achievements table for defining all available achievements
  pgm.createTable("achievements", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
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
      default: pgm.func("NOW()"),
    },
    updated_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("NOW()"),
    },
  });

  // Add constraints for achievements
  pgm.addConstraint("achievements", "achievements_category_check", {
    check:
      "category IN ('gameplay', 'collection', 'social', 'progression', 'special')",
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

  // Create the user_achievements table for tracking user progress
  pgm.createTable("user_achievements", {
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
      default: pgm.func("NOW()"),
    },
    updated_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("NOW()"),
    },
  });

  // Unique constraint for user-achievement pairs
  pgm.createIndex("user_achievements", ["user_id", "achievement_id"], {
    unique: true,
    name: "user_achievements_user_achievement_unique",
  });

  // Indexes for efficient queries
  pgm.createIndex("achievements", "category");
  pgm.createIndex("achievements", "type");
  pgm.createIndex("achievements", "rarity");
  pgm.createIndex("achievements", ["is_active", "sort_order"]);
  pgm.createIndex("user_achievements", "user_id");
  pgm.createIndex("user_achievements", "achievement_id");
  pgm.createIndex("user_achievements", ["user_id", "is_completed"]);
  pgm.createIndex("user_achievements", ["user_id", "is_claimed"]);

  // Function to update user_achievements updated_at timestamp
  pgm.sql(`
    CREATE OR REPLACE FUNCTION update_user_achievements_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Trigger to automatically update updated_at
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
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Trigger to automatically update updated_at for achievements
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
        NEW.completed_at = NOW();
      END IF;
      
      -- If achievement is being claimed for the first time
      IF NEW.is_claimed = true AND OLD.is_claimed = false THEN
        NEW.claimed_at = NOW();
      END IF;
      
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Trigger for auto-setting completion timestamps
  pgm.sql(`
    CREATE TRIGGER auto_set_achievement_completion_trigger
    BEFORE UPDATE ON user_achievements
    FOR EACH ROW
    EXECUTE FUNCTION auto_set_achievement_completion();
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
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Drop triggers first
  pgm.sql(
    "DROP TRIGGER IF EXISTS auto_set_achievement_completion_trigger ON user_achievements;"
  );
  pgm.sql(
    "DROP TRIGGER IF EXISTS update_achievements_updated_at_trigger ON achievements;"
  );
  pgm.sql(
    "DROP TRIGGER IF EXISTS update_user_achievements_updated_at_trigger ON user_achievements;"
  );

  // Drop functions
  pgm.sql("DROP FUNCTION IF EXISTS auto_set_achievement_completion();");
  pgm.sql("DROP FUNCTION IF EXISTS update_achievements_updated_at();");
  pgm.sql("DROP FUNCTION IF EXISTS update_user_achievements_updated_at();");

  // Drop tables (this will also drop indexes and constraints)
  pgm.dropTable("user_achievements");
  pgm.dropTable("achievements");
};
