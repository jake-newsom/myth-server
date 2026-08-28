/* eslint-disable camelcase */

/**
 * Adds the `rare_card` value to `shop_item_type`: a rare-tier slot on the daily
 * tab's rotation, alongside the existing legendary and epic slots.
 *
 * Ships ALONE, exactly as 1799000000000 did. Postgres refuses to let a
 * statement use an enum value whose adding transaction has not committed, so
 * the config row that references this label lives in 1799000000006, and the run
 * must pass `--no-single-transaction` (`npm run migrate:up:enum` locally,
 * `migrate:deploy` in `render:start`). See the long note in
 * 1799000000000_add-shop-overhaul-enum-values for the full mechanism.
 *
 * Release-safety: adding an enum label is additive. No existing row or response
 * changes, and no client can be handed this string until the config row and an
 * offering exist. Shipped clients render a shop offering from the presence of
 * its `card`, not from a switch on `item_type`, so an unrecognised type is
 * displayed as an ordinary card tile rather than skipped or crashed on.
 *
 * No `down`: Postgres has no ALTER TYPE ... DROP VALUE. Unused labels are inert.
 */

exports.shorthands = undefined;

// Required: see the note above about enum values and transactions.
exports.disableTransaction = true;

exports.up = (pgm) => {
  pgm.sql(`ALTER TYPE shop_item_type ADD VALUE IF NOT EXISTS 'rare_card';`);
};

exports.down = () => {
  // Intentionally a no-op: Postgres cannot drop an enum value.
};
