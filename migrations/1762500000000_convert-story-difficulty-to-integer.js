/**
 * Migration to convert story_mode_config.difficulty from enum to integer (1-5)
 * This aligns with the new chapter-based difficulty system where each chapter
 * has 5 difficulty levels corresponding to AI card levels.
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
  // Step 1: Add a temporary integer column
  pgm.addColumn('story_mode_config', {
    difficulty_new: {
      type: 'integer',
      comment: 'AI difficulty level (1-5) corresponding to card levels'
    }
  });

  // Step 2: Map old enum values to new integer values
  // easy -> 1, medium -> 2, hard -> 3, legendary -> 5
  // Only update if table has rows (handles empty table case)
  pgm.sql(`
    UPDATE story_mode_config
    SET difficulty_new = CASE
      WHEN difficulty::text = 'easy' THEN 1
      WHEN difficulty::text = 'medium' THEN 2
      WHEN difficulty::text = 'hard' THEN 3
      WHEN difficulty::text = 'legendary' THEN 5
      ELSE 1
    END
    WHERE EXISTS (SELECT 1 FROM story_mode_config LIMIT 1)
  `);

  // Step 3: Set default for any null values (shouldn't happen, but safety)
  pgm.sql(`
    UPDATE story_mode_config
    SET difficulty_new = 1
    WHERE difficulty_new IS NULL
  `);

  // Step 4: Make the new column NOT NULL
  pgm.alterColumn('story_mode_config', 'difficulty_new', {
    notNull: true
  });

  // Step 5: Drop the old difficulty column
  pgm.dropColumn('story_mode_config', 'difficulty');

  // Step 6: Rename the new column to difficulty
  pgm.renameColumn('story_mode_config', 'difficulty_new', 'difficulty');

  // Step 7: Add check constraint to ensure difficulty is between 1 and 5
  pgm.addConstraint('story_mode_config', 'story_difficulty_range', {
    check: 'difficulty >= 1 AND difficulty <= 5'
  });

  // Step 8: Drop the old enum type (only if no other tables use it)
  // Note: We check first to avoid errors if it's used elsewhere
  await pgm.db.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = 'story_difficulty'
        AND EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE data_type = 'USER-DEFINED'
          AND udt_name = 'story_difficulty'
        )
      ) THEN
        DROP TYPE IF EXISTS story_difficulty;
      END IF;
    END $$;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = async (pgm) => {
  // Recreate the enum type
  pgm.createType('story_difficulty', [
    'easy',
    'medium',
    'hard',
    'legendary'
  ]);

  // Add temporary enum column
  pgm.addColumn('story_mode_config', {
    difficulty_old: {
      type: 'story_difficulty',
      comment: 'Temporary column for rollback'
    }
  });

  // Map integer values back to enum
  // 1 -> easy, 2 -> medium, 3 -> hard, 4 -> hard (closest), 5 -> legendary
  await pgm.db.query(`
    UPDATE story_mode_config
    SET difficulty_old = CASE
      WHEN difficulty = 1 THEN 'easy'::story_difficulty
      WHEN difficulty = 2 THEN 'medium'::story_difficulty
      WHEN difficulty = 3 THEN 'hard'::story_difficulty
      WHEN difficulty = 4 THEN 'hard'::story_difficulty
      WHEN difficulty = 5 THEN 'legendary'::story_difficulty
      ELSE 'easy'::story_difficulty
    END
  `);

  // Drop check constraint
  pgm.dropConstraint('story_mode_config', 'story_difficulty_range');

  // Drop integer column
  pgm.dropColumn('story_mode_config', 'difficulty');

  // Rename enum column
  pgm.renameColumn('story_mode_config', 'difficulty_old', 'difficulty');

  // Make it NOT NULL
  pgm.alterColumn('story_mode_config', 'difficulty', {
    notNull: true
  });
};

