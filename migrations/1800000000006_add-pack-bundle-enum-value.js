/* eslint-disable camelcase */

/**
 * Adds the `pack_bundle_10` shop item type: ten packs in one purchase.
 *
 * Pack buying is moving out of the Pack Opening screen (where it was a hidden
 * second storefront with a hardcoded 100-gem price and a 10% bulk discount,
 * duplicated in the client) and into the Shop, where every price already comes
 * from the API. The single `pack` offering covers 1-for-100; this label carries
 * the ten-pack at 900.
 *
 * A separate item type rather than a quantity discount: `purchaseItem` prices
 * everything as `offering.price * quantity`, with no notion of a tier. Teaching
 * that shared path about discounts would put a pricing rule in front of every
 * item in the shop to serve one of them. A bundle row is self-describing, and
 * already-shipped clients render it off `offering.price` like any other slot.
 *
 * ## Ships ALONE, like 1798000000001 and 1799000000000
 *
 * Postgres refuses to let a statement use an enum value whose adding
 * transaction has not committed, so the config row that references this label
 * lives in the NEXT migration file, not here. See the long note in
 * 1799000000000_add-shop-overhaul-enum-values.js: `disableTransaction` alone is
 * not enough, because node-pg-migrate wraps the whole run in one transaction by
 * default. The run must use `--no-single-transaction` — `npm run migrate:deploy`
 * in production (what `render:start` calls), `npm run migrate:up:enum` locally.
 *
 * Release-safety: adding an enum label is additive and inert until an offering
 * exists. No `down`: Postgres has no ALTER TYPE ... DROP VALUE.
 */

exports.shorthands = undefined;

// Required: see the note above about enum values and transactions.
exports.disableTransaction = true;

exports.up = (pgm) => {
  pgm.sql(
    `ALTER TYPE shop_item_type ADD VALUE IF NOT EXISTS 'pack_bundle_10';`
  );
};

exports.down = () => {
  // Intentionally empty: enum values cannot be dropped, and an unreferenced
  // label costs nothing. The config row is removed by the migration that adds
  // it.
};
