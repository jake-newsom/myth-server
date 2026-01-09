/**
 * Migration to add Apple and Google authentication fields to users table
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  // Add Apple and Google authentication fields
  pgm.addColumn("users", {
    apple_id: {
      type: "varchar(255)",
      notNull: false,
      unique: true,
    },
    google_id: {
      type: "varchar(255)",
      notNull: false,
      unique: true,
    },
  });

  // Create indexes for Apple and Google ID lookups
  pgm.createIndex("users", "apple_id");
  pgm.createIndex("users", "google_id");

  // Update auth_provider to support new providers
  // Note: PostgreSQL doesn't support ALTER TYPE for enums easily, so we'll keep it as varchar
  // The application layer will enforce the valid values: 'local', 'facebook', 'apple', 'google'
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Remove indexes
  pgm.dropIndex("users", "apple_id");
  pgm.dropIndex("users", "google_id");
  
  // Remove Apple and Google authentication fields
  pgm.dropColumn("users", "apple_id");
  pgm.dropColumn("users", "google_id");
};


