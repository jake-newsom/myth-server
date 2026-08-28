/* eslint-disable camelcase */

/**
 * Adds the enum values Embers needs: `embers` on `monthly_reward_type` and
 * `ember_bundle` on `shop_item_type`.
 *
 * Ships ALONE and outside a transaction, for the same reason as
 * 1792000000000_add-ranked-draft-game-mode: Postgres refuses to let a statement
 * use an enum value added in the same transaction ("unsafe use of new value ...
 * New enum values must be committed before they can be used"). node-pg-migrate
 * wraps a run in one transaction by default, so this file sets
 * `disableTransaction = true` and contains NOTHING but the two ALTER TYPEs.
 *
 * The daily shop's ember_bundle config row therefore lives in the migration
 * after this one, not here — inserting it alongside the ALTER TYPE is precisely
 * the thing Postgres rejects.
 *
 * Release-safety: adding an enum value is additive. No existing row changes and
 * no existing query behaves differently. Nothing can hand an old client one of
 * these strings until a config row is authored to use it — which for the
 * monthly login calendar has deliberately not happened yet.
 *
 * There is no `down`: Postgres has no `ALTER TYPE ... DROP VALUE`, and
 * recreating the types would mean rewriting every dependent column. An unused
 * label is harmless.
 */

exports.shorthands = undefined;

// Required: see the note above about enum values and transactions.
exports.disableTransaction = true;

exports.up = (pgm) => {
  pgm.sql(`ALTER TYPE monthly_reward_type ADD VALUE IF NOT EXISTS 'embers';`);
  pgm.sql(`ALTER TYPE shop_item_type ADD VALUE IF NOT EXISTS 'ember_bundle';`);
};

exports.down = () => {
  // Intentionally a no-op: Postgres cannot drop an enum value. Leaving the
  // unused labels in place is harmless and strictly safer than recreating the
  // types against live data.
};
