/* eslint-disable camelcase */

/**
 * Adds the `ranked_draft` value to the `game_mode` enum.
 *
 * This is the first phase of Ranked Draft PvP, and it ships ALONE, ahead of any
 * code that writes the value. That is not a stylistic choice:
 *
 *   Postgres cannot use a newly-added enum value in the same transaction that
 *   added it (until PG12 for some cases, and still a hazard generally). Because
 *   node-pg-migrate wraps each run in a transaction by default, this migration
 *   sets `disableTransaction = true` and contains NOTHING ELSE. Any statement
 *   that referenced 'ranked_draft' here would fail.
 *
 * Release-safety: adding an enum value is additive. No existing row changes, no
 * existing query behaves differently, and nothing writes the new value until a
 * later release. Old clients cannot receive a game_mode they don't understand
 * because no such game can be created yet.
 *
 * There is deliberately no `down`. Postgres offers no `ALTER TYPE ... DROP
 * VALUE`; reversing this would mean recreating the type and rewriting every
 * dependent column, which is far more destructive than leaving an unused label
 * in place.
 */

exports.shorthands = undefined;

// Required: see the note above about enum values and transactions.
exports.disableTransaction = true;

exports.up = (pgm) => {
  pgm.sql(`ALTER TYPE game_mode ADD VALUE IF NOT EXISTS 'ranked_draft';`);
};

exports.down = () => {
  // Intentionally a no-op: Postgres cannot drop an enum value. Leaving the
  // unused label in place is harmless and strictly safer than recreating the
  // type against live `games` data.
};
