/**
 * Audit + idempotency ledger for achievement reward backfills.
 *
 * The 2026-08-17 re-cost (scripts/achievements-rework.sql) raised the reward
 * values on nearly every achievement. Players who had already completed AND
 * claimed those achievements were paid the old, much smaller amounts. The
 * backfill script pays the per-currency difference.
 *
 * One row per (batch, user, achievement) recording exactly what was granted.
 * The UNIQUE constraint is the resumability guarantee: the script inserts the
 * ledger row in the same transaction as the grant, so a crash can never
 * double-pay on re-run.
 *
 * Purely additive — no existing table is touched, so this is safe to deploy
 * ahead of the script and safe against old clients.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.createTable("achievement_reward_backfills", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("uuid_generate_v4()"),
    },
    batch_key: { type: "varchar(50)", notNull: true },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(user_id)",
      onDelete: "CASCADE",
    },
    achievement_id: {
      type: "uuid",
      notNull: true,
      references: "achievements(id)",
      onDelete: "CASCADE",
    },
    granted_gems: { type: "integer", notNull: true, default: 0 },
    granted_packs: { type: "integer", notNull: true, default: 0 },
    granted_fate: { type: "integer", notNull: true, default: 0 },
    granted_fragments: { type: "integer", notNull: true, default: 0 },
    // The single per-user mail carrying the gem/pack/fate attachments. Null for
    // rows written before the mail is created, and for zero-total rows.
    mail_id: {
      type: "uuid",
      references: "mail(id)",
      onDelete: "SET NULL",
    },
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  pgm.addConstraint(
    "achievement_reward_backfills",
    "achievement_reward_backfills_unique",
    "UNIQUE (batch_key, user_id, achievement_id)"
  );

  // Resume cursor scans "which users has this batch already covered?".
  pgm.createIndex("achievement_reward_backfills", ["batch_key", "user_id"]);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropTable("achievement_reward_backfills");
};
