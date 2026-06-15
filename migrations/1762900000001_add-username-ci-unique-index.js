/**
 * Migration to enforce case-insensitive uniqueness of usernames at the DB level.
 *
 * Usernames are stored with their original casing, but matching and uniqueness
 * are case-insensitive (login is by username now). The original column-level
 * UNIQUE constraint is case-sensitive, so without this index "Jake" and "jake"
 * could both be inserted by a near-simultaneous registration that slips past
 * the application-level check. This adds a unique index on lower(username) to
 * close that gap.
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  // Case-insensitive unique index on username. Will fail if existing rows
  // already collide on lower(username); resolve any such rows before running.
  pgm.createIndex("users", "lower(username)", {
    name: "users_lower_username_unique_idx",
    unique: true,
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.dropIndex("users", "lower(username)", {
    name: "users_lower_username_unique_idx",
  });
};
