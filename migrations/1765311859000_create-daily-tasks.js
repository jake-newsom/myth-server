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
  // Create daily_task_definitions table - static task definitions
  pgm.createTable("daily_task_definitions", {
    task_key: {
      type: "varchar(50)",
      primaryKey: true,
    },
    title: {
      type: "varchar(100)",
      notNull: true,
    },
    description: {
      type: "text",
      notNull: true,
    },
    target_value: {
      type: "integer",
      notNull: true,
      default: 1,
    },
    tracking_type: {
      type: "varchar(30)",
      notNull: true,
      comment: "Type: fate_pick, pack_open, defeat, win, level_up, defeat_mythology, curse, destroy, bless",
    },
    tracking_metadata: {
      type: "jsonb",
      default: "{}",
      comment: "Additional metadata like mythology for faction-specific tasks",
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
  });

  // Create daily_task_selections table - server-wide daily selections
  pgm.createTable("daily_task_selections", {
    selection_date: {
      type: "date",
      primaryKey: true,
    },
    selected_task_keys: {
      type: "varchar(50)[]",
      notNull: true,
      comment: "Array of 5 task keys selected for this day",
    },
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  // Create user_daily_task_progress table - per-user progress tracking
  pgm.createTable("user_daily_task_progress", {
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(user_id)",
      onDelete: "CASCADE",
    },
    progress_date: {
      type: "date",
      notNull: true,
    },
    task_progress: {
      type: "jsonb",
      notNull: true,
      default: "{}",
      comment: "Progress per task: {task_key: count}",
    },
    rewards_claimed: {
      type: "integer",
      notNull: true,
      default: 0,
      comment: "Number of reward tiers claimed (0-5)",
    },
    updated_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  // Create composite primary key for user_daily_task_progress
  pgm.addConstraint("user_daily_task_progress", "user_daily_task_progress_pkey", {
    primaryKey: ["user_id", "progress_date"],
  });

  // Create indexes
  pgm.createIndex("user_daily_task_progress", "progress_date");
  pgm.createIndex("user_daily_task_progress", "user_id");
  pgm.createIndex("daily_task_selections", "selection_date");

  // Seed the 11 task definitions
  pgm.sql(`
    INSERT INTO daily_task_definitions (task_key, title, description, target_value, tracking_type, tracking_metadata)
    VALUES
      ('fate_pick', 'Divine Choice', 'Complete a Fate Pick', 1, 'fate_pick', '{}'),
      ('open_pack', 'Pack Opener', 'Open a card pack', 1, 'pack_open', '{}'),
      ('defeat_20', 'Card Crusher', 'Defeat 20 cards in matches', 20, 'defeat', '{}'),
      ('win_5', 'Victorious', 'Win 5 matches', 5, 'win', '{}'),
      ('level_up', 'Power Up', 'Level up a card', 1, 'level_up', '{}'),
      ('defeat_norse_10', 'Norse Slayer', 'Defeat 10 cards using a Norse card', 10, 'defeat_mythology', '{"mythology": "norse"}'),
      ('defeat_japanese_10', 'Japanese Slayer', 'Defeat 10 cards using a Japanese card', 10, 'defeat_mythology', '{"mythology": "japanese"}'),
      ('defeat_polynesian_10', 'Polynesian Slayer', 'Defeat 10 cards using a Polynesian card', 10, 'defeat_mythology', '{"mythology": "polynesian"}'),
      ('curse_10', 'Curse Caster', 'Curse 10 tiles', 10, 'curse', '{}'),
      ('destroy_5', 'Destroyer', 'Destroy 5 cards', 5, 'destroy', '{}'),
      ('bless_10', 'Blessing Giver', 'Bless 10 tiles', 10, 'bless', '{}');
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.dropTable("user_daily_task_progress");
  pgm.dropTable("daily_task_selections");
  pgm.dropTable("daily_task_definitions");
};

