/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  // Create user_sessions table for token-based authentication
  pgm.createTable("user_sessions", {
    session_id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("uuid_generate_v4()"),
    },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(user_id)",
      onDelete: "CASCADE",
    },
    access_token_hash: {
      type: "varchar(64)", // SHA-256 hash length
      notNull: true,
      unique: true,
    },
    refresh_token_hash: {
      type: "varchar(64)", // SHA-256 hash length
      notNull: true,
      unique: true,
    },
    access_token_expires_at: {
      type: "timestamp",
      notNull: true,
    },
    refresh_token_expires_at: {
      type: "timestamp",
      notNull: true,
    },
    device_type: {
      type: "varchar(50)",
      notNull: false,
    },
    user_agent: {
      type: "text",
      notNull: false,
    },
    ip_address: {
      type: "inet",
      notNull: false,
    },
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
    last_used_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
    is_active: {
      type: "boolean",
      notNull: true,
      default: true,
    },
  });

  // Create indexes for performance
  pgm.createIndex("user_sessions", "user_id");
  pgm.createIndex("user_sessions", "access_token_hash");
  pgm.createIndex("user_sessions", "refresh_token_hash");
  pgm.createIndex("user_sessions", "access_token_expires_at");
  pgm.createIndex("user_sessions", "refresh_token_expires_at");
  pgm.createIndex("user_sessions", ["user_id", "is_active"]);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Drop indexes first
  pgm.dropIndex("user_sessions", ["user_id", "is_active"]);
  pgm.dropIndex("user_sessions", "refresh_token_expires_at");
  pgm.dropIndex("user_sessions", "access_token_expires_at");
  pgm.dropIndex("user_sessions", "refresh_token_hash");
  pgm.dropIndex("user_sessions", "access_token_hash");
  pgm.dropIndex("user_sessions", "user_id");
  
  // Drop the table
  pgm.dropTable("user_sessions");
};
