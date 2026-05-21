/**
 * Migration to add 'mulligan' value to game_status enum.
 *
 * Used to mark games that are in the pre-turn-1 card-replacement phase.
 * Status flips to 'active' once both players have committed.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.addTypeValue("game_status", "mulligan", { ifNotExists: true });
  console.log('✓ Added "mulligan" to game_status enum');
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  // PostgreSQL does not support removing values from an enum type directly.
  // For safety we only reset the data; the enum value remains harmless.
  pgm.sql(`UPDATE "games" SET game_status = 'pending' WHERE game_status = 'mulligan'`);
  console.log('⚠ Reverted all "mulligan" rows to "pending". Enum value remains (PostgreSQL limitation).');
};
