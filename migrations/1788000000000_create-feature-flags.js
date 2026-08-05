/**
 * Feature flags.
 *
 * Lets a feature ship to production dark, stay dark for everyone, and be turned
 * on for a single test account while the live app keeps running the old path.
 *
 * Two tables:
 *   - feature_flags        : the flag itself, plus `enabled_globally`
 *   - user_feature_flags   : per-user overrides, one row per (flag, user)
 *
 * Resolution order (see FeatureFlagService.isEnabled):
 *   1. an explicit user_feature_flags row wins, in EITHER direction — so a flag
 *      that is globally on can still be forced off for one user, which is the
 *      escape hatch when a rollout goes wrong for a specific account
 *   2. otherwise fall back to feature_flags.enabled_globally
 *   3. unknown key => false (never throws; a typo must not break prod)
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.createTable("feature_flags", {
    feature_flag_id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("uuid_generate_v4()"),
    },
    // Stored lowercased/trimmed; all lookups normalize the same way so keys are
    // effectively case-insensitive ("New-Tower" and "new-tower" are one flag).
    key: {
      type: "varchar(128)",
      notNull: true,
      unique: true,
    },
    description: {
      type: "text",
      notNull: false,
    },
    // The "ALL users" switch. Defaults to false so a newly created flag is
    // always dark until someone deliberately turns it on.
    enabled_globally: {
      type: "boolean",
      notNull: true,
      default: false,
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  pgm.createTable("user_feature_flags", {
    feature_flag_id: {
      type: "uuid",
      notNull: true,
      references: "feature_flags(feature_flag_id)",
      onDelete: "CASCADE",
    },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(user_id)",
      onDelete: "CASCADE",
    },
    // NOT a grant-only table: false here means "explicitly off for this user",
    // which is why resolution checks for row EXISTENCE before reading the value.
    enabled: {
      type: "boolean",
      notNull: true,
      default: true,
    },
    // Free-text "why does this user have this?" — e.g. "jake's test account".
    note: {
      type: "text",
      notNull: false,
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  // One override per (flag, user); makes the upsert in the model a clean
  // ON CONFLICT ... DO UPDATE.
  pgm.addConstraint(
    "user_feature_flags",
    "user_feature_flags_pkey",
    { primaryKey: ["feature_flag_id", "user_id"] }
  );

  // The hot path is "all flags for this user", which drives the cache warm.
  pgm.createIndex("user_feature_flags", "user_id");
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropTable("user_feature_flags");
  pgm.dropTable("feature_flags");
};
