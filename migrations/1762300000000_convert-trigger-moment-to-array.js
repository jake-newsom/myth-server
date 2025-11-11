/**
 * Convert trigger_moment to trigger_moments array
 * This migration converts the single trigger_moment field to an array of trigger moments
 * to support abilities that can trigger on multiple events.
 * 
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  // First, add the new trigger_moments array column
  pgm.addColumn("special_abilities", {
    trigger_moments: {
      type: "trigger_moment[]",
      notNull: false, // Allow null temporarily during migration
    }
  });

  // Migrate existing data: convert single trigger_moment to array
  pgm.sql(`
    UPDATE special_abilities 
    SET trigger_moments = ARRAY[trigger_moment]::trigger_moment[]
    WHERE trigger_moment IS NOT NULL;
  `);

  // Make the new column not null and set default
  pgm.alterColumn("special_abilities", "trigger_moments", {
    notNull: true,
    default: "'{}'::trigger_moment[]"
  });

  // Drop the old trigger_moment column
  pgm.dropColumn("special_abilities", "trigger_moment");

  // Add index for efficient querying of trigger arrays
  pgm.createIndex("special_abilities", "trigger_moments", { method: "gin" });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Add back the single trigger_moment column
  pgm.addColumn("special_abilities", {
    trigger_moment: {
      type: "trigger_moment",
      notNull: false,
    }
  });

  // Migrate data back: take first element from array
  pgm.sql(`
    UPDATE special_abilities 
    SET trigger_moment = trigger_moments[1]
    WHERE array_length(trigger_moments, 1) > 0;
  `);

  // Make trigger_moment not null
  pgm.alterColumn("special_abilities", "trigger_moment", {
    notNull: true,
  });

  // Drop the array column and its index
  pgm.dropIndex("special_abilities", "trigger_moments");
  pgm.dropColumn("special_abilities", "trigger_moments");
};
