/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  // Add new enum values to existing enums
  pgm.sql(`
    DO $$
    BEGIN
      -- Check if 'uncommon' exists in card_rarity
      IF NOT EXISTS (
        SELECT 1 FROM pg_type 
        JOIN pg_enum ON pg_enum.enumtypid = pg_type.oid 
        WHERE pg_type.typname = 'card_rarity' AND pg_enum.enumlabel = 'uncommon'
      ) THEN
        -- If it doesn't exist, add it
        ALTER TYPE card_rarity ADD VALUE 'uncommon';
      END IF;
      
      -- Check if 'OnAnyFlip' exists in trigger_moment
      IF NOT EXISTS (
        SELECT 1 FROM pg_type 
        JOIN pg_enum ON pg_enum.enumtypid = pg_type.oid 
        WHERE pg_type.typname = 'trigger_moment' AND pg_enum.enumlabel = 'OnAnyFlip'
      ) THEN
        -- If it doesn't exist, add it
        ALTER TYPE trigger_moment ADD VALUE 'OnAnyFlip';
      END IF;
    END $$;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Note: PostgreSQL doesn't support removing enum values
  // This is a limitation of PostgreSQL enums
  // In production, you would need to recreate the enum type
  pgm.sql('-- Cannot remove enum values in PostgreSQL');
}; 