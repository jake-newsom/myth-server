/**
 * Migration to add Facebook authentication fields to users table
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  // Add Facebook authentication fields
  pgm.addColumn("users", {
    facebook_id: {
      type: "varchar(255)",
      notNull: false,
      unique: true,
    },
    auth_provider: {
      type: "varchar(50)",
      notNull: true,
      default: "'local'",
    },
  });

  // Make password_hash nullable for social auth users
  pgm.alterColumn("users", "password_hash", {
    notNull: false,
  });

  // Create index for Facebook ID lookups
  pgm.createIndex("users", "facebook_id");
  pgm.createIndex("users", "auth_provider");

  // Update existing users to have 'local' auth_provider
  pgm.sql(`UPDATE users SET auth_provider = 'local' WHERE auth_provider IS NULL OR auth_provider = '';`);
  
  // Note: Constraint will be added later after ensuring all existing users are properly set up
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Remove indexes
  pgm.dropIndex("users", "facebook_id");
  pgm.dropIndex("users", "auth_provider");
  
  // Make password_hash not null again
  pgm.alterColumn("users", "password_hash", {
    notNull: true,
  });
  
  // Remove Facebook authentication fields
  pgm.dropColumn("users", "facebook_id");
  pgm.dropColumn("users", "auth_provider");
};
