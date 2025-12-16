/**
 * Add role column to users table for admin authorization
 * 
 * This migration adds a 'role' column to support role-based access control.
 * Default role is 'user', and admins can be set to 'admin'.
 * 
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  // Create role enum type
  pgm.createType('user_role', ['user', 'admin']);

  // Add role column to users table
  pgm.addColumn('users', {
    role: {
      type: 'user_role',
      notNull: true,
      default: 'user',
    },
  });

  // Add index for faster role-based queries
  pgm.createIndex('users', 'role');

  // Add comment for documentation
  pgm.sql(`
    COMMENT ON COLUMN users.role IS 'User role for authorization (user, admin)';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Remove index
  pgm.dropIndex('users', 'role');

  // Remove column
  pgm.dropColumn('users', 'role');

  // Drop enum type
  pgm.dropType('user_role');
};
