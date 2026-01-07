/**
 * Migration: Add average_card_level column to tower_floors table
 * This helps track difficulty scaling by storing the average card level for each floor
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  console.log("Adding average_card_level column to tower_floors table...");

  // Add the column (nullable since existing floors won't have this data)
  pgm.addColumn("tower_floors", {
    average_card_level: {
      type: "numeric(4, 1)",
      notNull: false,
    },
  });

  console.log("✓ Added average_card_level column to tower_floors");

  // Optionally calculate and backfill for existing floors
  console.log("Calculating average_card_level for existing floors...");
  
  pgm.sql(`
    UPDATE tower_floors tf
    SET average_card_level = (
      SELECT ROUND(AVG(uoc.level)::numeric, 1)
      FROM deck_cards dc
      JOIN user_owned_cards uoc ON dc.user_card_instance_id = uoc.user_card_instance_id
      WHERE dc.deck_id = tf.ai_deck_id
    )
    WHERE tf.average_card_level IS NULL;
  `);

  console.log("✓ Backfilled average_card_level for existing floors");
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  console.log("Removing average_card_level column from tower_floors table...");

  pgm.dropColumn("tower_floors", "average_card_level");

  console.log("✓ Removed average_card_level column from tower_floors");
};

