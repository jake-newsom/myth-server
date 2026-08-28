/* eslint-disable camelcase */

/**
 * Seeds the daily shop's ember bundle: 60 embers for gems, repeatable.
 *
 * NOTE: this seeds the ORIGINAL 100-gem price. Migration 1798000000003
 * reprices it to 300. The seed is left at its historical value rather than
 * edited in place, so that replaying the migration history reproduces the same
 * sequence of states on every database.
 *
 * ## Why this sets `disableTransaction`
 *
 * The previous migration adds `ember_bundle` to the `shop_item_type` enum, and
 * Postgres refuses to let any statement use an enum value that was added by a
 * transaction that has not yet committed ("unsafe use of new value ... New enum
 * values must be committed before they can be used").
 *
 * Splitting the ALTER TYPE into its own FILE is not sufficient, because
 * node-pg-migrate wraps a whole `up` RUN in one transaction — a single
 * `npm run migrate:up` on a fresh database would execute the ALTER TYPE and
 * this INSERT inside the same transaction and fail. That matters directly:
 * render.yaml's `render:start` is `npm run migrate:up && npm start`, one
 * invocation, so a deploy has to survive running both in sequence.
 *
 * With `disableTransaction = true` on both this file and the enum migration,
 * each runs and commits on its own, and the ALTER TYPE is durable by the time
 * this INSERT references the value.
 *
 * The trade-off of running outside a transaction is that a mid-migration
 * failure cannot roll back. That is acceptable here because the migration is a
 * single idempotent statement: `ON CONFLICT DO NOTHING` against the unique
 * `item_type` constraint means re-running it is a no-op, and a failure leaves
 * either no row or the intended row, never a partial one.
 *
 * ## On "infinitely purchasable"
 *
 * The shop has no sentinel for an unlimited item.
 * DailyShopService.purchaseItem enforces `purchased + quantity > daily_limit`
 * against the per-day total, so an effectively unreachable limit is how a
 * repeatable item is expressed. 100000 purchases would cost millions of gems,
 * so the cap can never be the thing that stops a player.
 *
 * reset_price_gems is 0 because the limit is never reached, making the reset
 * path unreachable — there is nothing to buy back.
 *
 * daily_availability is 1: one ember bundle slot appears per day, and that
 * single offering can be bought over and over.
 */

exports.shorthands = undefined;

// Required: this INSERT references an enum value added by the immediately
// preceding migration, which must be committed first. See the note above.
exports.disableTransaction = true;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO daily_shop_config
      (item_type, daily_limit, price, currency, daily_availability, is_active, reset_price_gems)
    VALUES
      ('ember_bundle', 100000, 100, 'gems', 1, true, 0)
    ON CONFLICT (item_type) DO NOTHING;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  // Purchases reference the offering rather than the config, so dropping these
  // leaves purchase history intact.
  pgm.sql(`DELETE FROM daily_shop_offerings WHERE item_type = 'ember_bundle';`);
  pgm.sql(`DELETE FROM daily_shop_config WHERE item_type = 'ember_bundle';`);
};
