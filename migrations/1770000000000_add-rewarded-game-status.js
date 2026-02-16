/**
 * Migration to add 'rewarded' value to game_status enum
 *
 * This new status is used to mark tower games whose rewards have already
 * been claimed, preventing duplicate reward claims via race conditions
 * or replay attacks.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.addTypeValue("game_status", "rewarded", { ifNotExists: true });
  console.log('✓ Added "rewarded" to game_status enum');
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  // PostgreSQL does not support removing values from an enum type directly.
  // To fully reverse this, you would need to:
  //   1. Update any rows with game_status = 'rewarded' back to 'completed'
  //   2. Recreate the enum without 'rewarded'
  //   3. Alter the column to use the new enum
  // For safety we only reset the data; the enum value remains harmless.
  pgm.sql(`UPDATE "games" SET game_status = 'completed' WHERE game_status = 'rewarded'`);
  console.log('⚠ Reverted all "rewarded" rows to "completed". Enum value remains (PostgreSQL limitation).');
};
