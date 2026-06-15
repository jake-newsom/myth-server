/**
 * Migration to make the users.email column optional.
 *
 * Email is no longer collected at registration; usernames are now the sole
 * required identifier. The column is retained so existing users keep their
 * email until they have a chance to migrate. Postgres UNIQUE constraints
 * already permit multiple NULLs, so the existing unique index is left in place.
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  // Email is now optional - new (username-only) accounts will not have one.
  pgm.alterColumn("users", "email", {
    notNull: false,
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Restore the NOT NULL constraint. This will fail if any rows have a NULL
  // email; such rows must be backfilled before rolling back.
  pgm.alterColumn("users", "email", {
    notNull: true,
  });
};
