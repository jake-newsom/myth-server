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
  // Create enum for story mode difficulty levels
  pgm.createType('story_difficulty', [
    'easy',
    'medium', 
    'hard',
    'legendary'
  ]);

  // Create story mode configuration table
  pgm.createTable('story_mode_config', {
    story_id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    name: {
      type: 'varchar(100)',
      notNull: true,
      comment: 'Display name for the story mode opponent'
    },
    description: {
      type: 'text',
      comment: 'Flavor text or description of the opponent'
    },
    difficulty: {
      type: 'story_difficulty',
      notNull: true,
      comment: 'AI difficulty level for this story mode'
    },
    ai_deck_id: {
      type: 'uuid',
      notNull: true,
      references: 'decks(deck_id)',
      onDelete: 'CASCADE',
      comment: 'The AI deck this story mode uses'
    },
    order_index: {
      type: 'integer',
      notNull: true,
      default: 0,
      comment: 'Order in which story modes should be displayed'
    },
    is_active: {
      type: 'boolean',
      notNull: true,
      default: true,
      comment: 'Whether this story mode is currently available'
    },
    unlock_requirements: {
      type: 'jsonb',
      default: '{}',
      comment: 'JSON object defining requirements to unlock this story mode'
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
    updated_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  // Create story mode rewards table
  pgm.createTable('story_mode_rewards', {
    reward_id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    story_id: {
      type: 'uuid',
      notNull: true,
      references: 'story_mode_config(story_id)',
      onDelete: 'CASCADE',
    },
    reward_type: {
      type: 'varchar(50)',
      notNull: true,
      comment: 'Type of reward: first_win, repeat_win, achievement, etc.'
    },
    reward_data: {
      type: 'jsonb',
      notNull: true,
      comment: 'JSON object containing reward details (gold, gems, cards, etc.)'
    },
    is_active: {
      type: 'boolean',
      notNull: true,
      default: true,
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  // Create story mode progress tracking table
  pgm.createTable('user_story_progress', {
    progress_id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users(user_id)',
      onDelete: 'CASCADE',
    },
    story_id: {
      type: 'uuid',
      notNull: true,
      references: 'story_mode_config(story_id)',
      onDelete: 'CASCADE',
    },
    times_completed: {
      type: 'integer',
      notNull: true,
      default: 0,
      comment: 'Number of times user has beaten this story mode'
    },
    first_completed_at: {
      type: 'timestamp',
      comment: 'When the user first beat this story mode'
    },
    last_completed_at: {
      type: 'timestamp',
      comment: 'When the user last beat this story mode'
    },
    best_completion_time: {
      type: 'integer',
      comment: 'Best completion time in seconds'
    },
    total_attempts: {
      type: 'integer',
      notNull: true,
      default: 0,
      comment: 'Total number of attempts (wins + losses)'
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
    updated_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  // Create indexes for performance
  pgm.createIndex('story_mode_config', 'order_index');
  pgm.createIndex('story_mode_config', 'is_active');
  pgm.createIndex('story_mode_config', 'difficulty');
  pgm.createIndex('story_mode_rewards', 'story_id');
  pgm.createIndex('story_mode_rewards', 'reward_type');
  pgm.createIndex('user_story_progress', 'user_id');
  pgm.createIndex('user_story_progress', 'story_id');
  pgm.createIndex('user_story_progress', ['user_id', 'story_id']);

  // Create unique constraint to prevent duplicate user progress entries
  pgm.addConstraint('user_story_progress', 'unique_user_story', {
    unique: ['user_id', 'story_id']
  });

  // Create unique constraint on order_index for active story modes
  pgm.addConstraint('story_mode_config', 'unique_active_order', {
    unique: ['order_index'],
    where: 'is_active = true'
  });

  // Create trigger to update updated_at timestamp
  pgm.sql(`
    CREATE OR REPLACE FUNCTION update_story_mode_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = current_timestamp;
      RETURN NEW;
    END;
    $$ language 'plpgsql';
  `);

  pgm.sql(`
    CREATE TRIGGER update_story_mode_config_updated_at
      BEFORE UPDATE ON story_mode_config
      FOR EACH ROW
      EXECUTE FUNCTION update_story_mode_updated_at();
  `);

  pgm.sql(`
    CREATE TRIGGER update_user_story_progress_updated_at
      BEFORE UPDATE ON user_story_progress
      FOR EACH ROW
      EXECUTE FUNCTION update_story_mode_updated_at();
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Drop triggers
  pgm.sql('DROP TRIGGER IF EXISTS update_user_story_progress_updated_at ON user_story_progress;');
  pgm.sql('DROP TRIGGER IF EXISTS update_story_mode_config_updated_at ON story_mode_config;');
  pgm.sql('DROP FUNCTION IF EXISTS update_story_mode_updated_at();');

  // Drop tables in reverse order
  pgm.dropTable('user_story_progress');
  pgm.dropTable('story_mode_rewards');
  pgm.dropTable('story_mode_config');

  // Drop types
  pgm.dropType('story_difficulty');
};
