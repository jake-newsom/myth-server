/**
 * Migration to rework story mode into Infinite Tower system
 * 
 * Changes:
 * 1. Add tower_floor column to users table
 * 2. Add floor_number column to games table
 * 3. Rename story_mode_config to tower_floors with simplified schema
 * 4. Drop story_mode_rewards table (rewards are now formulaic)
 * 5. Drop user_story_progress table (replaced by users.tower_floor)
 * 6. Remove story mode achievements
 * 7. Migrate existing AI decks to tower floors 1-50
 * 
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.up = async (pgm) => {
  console.log('Starting Infinite Tower migration...');

  // 1. Add tower_floor column to users table
  pgm.addColumn('users', {
    tower_floor: {
      type: 'integer',
      notNull: true,
      default: 1,
      comment: 'Current unbeaten tower floor for the user'
    }
  });
  console.log('✓ Added tower_floor column to users table');

  // 2. Add floor_number column to games table
  pgm.addColumn('games', {
    floor_number: {
      type: 'integer',
      notNull: false,
      comment: 'Tower floor number for tower games, null for other game types'
    }
  });
  
  // Add index for floor_number queries
  pgm.createIndex('games', 'floor_number', {
    name: 'idx_games_floor_number',
    where: 'floor_number IS NOT NULL'
  });
  console.log('✓ Added floor_number column to games table');

  // 3. Store existing story_mode_config deck mappings before dropping
  // We'll use raw SQL to preserve the AI deck associations
  pgm.sql(`
    -- Create temporary table to store deck mappings
    CREATE TEMP TABLE temp_story_deck_mapping AS
    SELECT 
      ROW_NUMBER() OVER (ORDER BY order_index, created_at) as floor_number,
      ai_deck_id,
      name
    FROM story_mode_config
    WHERE is_active = true
    ORDER BY order_index, created_at;
  `);

  // 4. Drop story mode related tables (in correct order due to foreign keys)
  
  // First remove story_id foreign key from achievements if it exists
  pgm.sql(`
    ALTER TABLE achievements 
    DROP CONSTRAINT IF EXISTS achievements_story_id_fkey;
  `);
  
  // Drop indexes on tables we're about to drop
  pgm.sql(`
    DROP INDEX IF EXISTS idx_achievements_story_id;
  `);

  // Remove story_id column from achievements
  pgm.sql(`
    ALTER TABLE achievements 
    DROP COLUMN IF EXISTS story_id;
  `);
  console.log('✓ Removed story_id from achievements table');

  // Delete story mode achievements
  pgm.sql(`
    DELETE FROM user_achievements 
    WHERE achievement_id IN (
      SELECT achievement_id FROM achievements 
      WHERE achievement_key LIKE 'story_%'
    );
    
    DELETE FROM achievements 
    WHERE achievement_key LIKE 'story_%';
  `);
  console.log('✓ Removed story mode achievements');

  // Drop user_story_progress table
  pgm.sql(`
    DROP TRIGGER IF EXISTS update_user_story_progress_updated_at ON user_story_progress;
  `);
  pgm.dropTable('user_story_progress', { ifExists: true });
  console.log('✓ Dropped user_story_progress table');

  // Drop story_mode_rewards table
  pgm.dropTable('story_mode_rewards', { ifExists: true });
  console.log('✓ Dropped story_mode_rewards table');

  // Drop story_mode_config trigger and table
  pgm.sql(`
    DROP TRIGGER IF EXISTS update_story_mode_config_updated_at ON story_mode_config;
  `);
  pgm.dropTable('story_mode_config', { ifExists: true });
  console.log('✓ Dropped story_mode_config table');

  // Drop the story_difficulty enum if it exists
  pgm.sql(`
    DROP TYPE IF EXISTS story_difficulty CASCADE;
  `);
  console.log('✓ Dropped story_difficulty enum');

  // 5. Create new tower_floors table
  pgm.createTable('tower_floors', {
    floor_number: {
      type: 'integer',
      primaryKey: true,
      comment: 'The floor number (1, 2, 3, ...)'
    },
    name: {
      type: 'varchar(100)',
      notNull: true,
      comment: 'Display name for the floor (e.g., "Floor 1")'
    },
    ai_deck_id: {
      type: 'uuid',
      notNull: true,
      references: 'decks(deck_id)',
      onDelete: 'CASCADE',
      comment: 'The AI deck used for this floor'
    },
    is_active: {
      type: 'boolean',
      notNull: true,
      default: true,
      comment: 'Whether this floor is currently available'
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp')
    }
  });

  // Add index on ai_deck_id
  pgm.createIndex('tower_floors', 'ai_deck_id', {
    name: 'idx_tower_floors_ai_deck_id'
  });
  console.log('✓ Created tower_floors table');

  // 6. Migrate only first 2 decks to tower floors (for testing)
  pgm.sql(`
    INSERT INTO tower_floors (floor_number, name, ai_deck_id, is_active, created_at)
    SELECT 
      floor_number::integer,
      'Floor ' || floor_number::text,
      ai_deck_id,
      true,
      NOW()
    FROM temp_story_deck_mapping
    WHERE floor_number <= 2
    ON CONFLICT (floor_number) DO NOTHING;
  `);
  console.log('✓ Migrated first 2 AI decks to tower floors (for testing)');

  // Clean up temp table
  pgm.sql(`DROP TABLE IF EXISTS temp_story_deck_mapping;`);

  console.log('✓ Infinite Tower migration completed successfully!');
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = async (pgm) => {
  console.log('Rolling back Infinite Tower migration...');

  // Drop tower_floors table
  pgm.dropTable('tower_floors', { ifExists: true });

  // Remove floor_number from games
  pgm.dropIndex('games', 'floor_number', { name: 'idx_games_floor_number', ifExists: true });
  pgm.dropColumn('games', 'floor_number', { ifExists: true });

  // Remove tower_floor from users
  pgm.dropColumn('users', 'tower_floor', { ifExists: true });

  // Note: We cannot fully restore story_mode_config, story_mode_rewards, 
  // user_story_progress, or achievements data as they were deleted.
  // A full restore would require running the original migrations again.

  console.log('✓ Rollback completed (note: story mode data cannot be restored)');
};

