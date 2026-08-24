/* eslint-disable camelcase */

/**
 * User bans — moderation without deletion.
 *
 * Before this, the only way to remove an abusive account was the hard delete in
 * user.controller.ts, which destroys the user, their cards, decks and sessions
 * AND their games — including match history belonging to the opponent. That is
 * both irreversible and destructive to bystanders, so it was never usable as a
 * moderation tool.
 *
 * All three columns are nullable with no default: every existing row is
 * therefore unbanned, no backfill is needed, and code that does not read these
 * columns behaves exactly as before. `banned_at IS NOT NULL` is the single
 * source of truth for "is this account banned".
 *
 * banned_by is ON DELETE SET NULL rather than CASCADE: deleting an admin
 * account must never silently unban the users they actioned.
 */

exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.addColumns("users", {
    banned_at: {
      type: "timestamptz",
      notNull: false,
      default: null,
    },
    banned_reason: {
      type: "text",
      notNull: false,
      default: null,
    },
    banned_by: {
      type: "uuid",
      notNull: false,
      default: null,
      references: '"users"',
      referencesConstraintName: "users_banned_by_fkey",
      onDelete: "SET NULL",
    },
  });

  // Partial index: bans are rare, and every lookup is "is this one banned" or
  // "list the banned ones". Indexing only non-null rows keeps it tiny.
  pgm.createIndex("users", "banned_at", {
    name: "users_banned_at_idx",
    where: "banned_at IS NOT NULL",
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropIndex("users", "banned_at", { name: "users_banned_at_idx" });
  pgm.dropColumns("users", ["banned_at", "banned_reason", "banned_by"]);
};
