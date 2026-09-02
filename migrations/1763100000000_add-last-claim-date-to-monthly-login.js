/**
 * Migration: Add last_claim_date to user_monthly_login_progress
 * 
 * Adds a last_claim_date column to track when users last claimed a reward,
 * enforcing one reward per calendar day.
 * 
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  // Idempotent: 1763000000000_add-monthly-login-rewards was later edited to create
  // this column inline, so on a fresh database it already exists by the time we run.
  // Databases migrated before that edit still need the column added here.
  pgm.sql(`
    ALTER TABLE "user_monthly_login_progress"
      ADD COLUMN IF NOT EXISTS "last_claim_date" date;
    COMMENT ON COLUMN "user_monthly_login_progress"."last_claim_date"
      IS 'Date (UTC) of the last reward claim - used to enforce one claim per calendar day';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE "user_monthly_login_progress"
      DROP COLUMN IF EXISTS "last_claim_date";
  `);
};

