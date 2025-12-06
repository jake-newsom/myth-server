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
  // Add last_claim_date column to user_monthly_login_progress table
  pgm.addColumn("user_monthly_login_progress", {
    last_claim_date: {
      type: "date",
      comment: "Date (UTC) of the last reward claim - used to enforce one claim per calendar day",
    },
  });
  
  console.log("Added last_claim_date column to user_monthly_login_progress table");
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Remove last_claim_date column from user_monthly_login_progress table
  pgm.dropColumn("user_monthly_login_progress", "last_claim_date");
  
  console.log("Removed last_claim_date column from user_monthly_login_progress table");
};

