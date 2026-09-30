/* eslint-disable camelcase */

/**
 * Moves pack BUYING into the Shop, and makes the Pack Opening screen pure
 * inventory.
 *
 * Opening used to top up a short pack balance by silently buying the difference
 * with gems, at a 100-gem price and 10% ten-pack discount hardcoded in
 * pack.service.ts AND mirrored in the client's ShopView so the two could drift.
 * That path is deleted in the same release. Buying now happens here, where the
 * client already renders `offering.price` straight off the API and computes no
 * prices of its own.
 *
 * Two rows:
 *
 *   pack            100 gems ->  1 pack
 *   pack_bundle_10  900 gems -> 10 packs   (the 10% bulk saving, priced in)
 *
 * The saving lives in the bundle's price because `purchaseItem` charges
 * `offering.price * quantity` and has no notion of a discount tier. See
 * 1800000000006, which adds the enum label and must be committed before this
 * file can reference it.
 *
 * ## The `pack` slot changes CURRENCY
 *
 * 1799000000009 had repriced it to 150 card fragments. That made packs compete
 * with the Forge for the one genuinely scarce currency while gems — which have
 * four faucets — had no comparable sink. Packs go back to gems so the
 * Gem -> Pack -> Card path is a single legible line, and fragments stay pointed
 * at the Forge.
 *
 * ## Always available, not rotated
 *
 * Both rows are `daily_availability = 1` (one slot each per day) with a high
 * `daily_limit`, so buying is never gated by a rotation the player has to wait
 * out — the ten-pack in particular is worthless if it appears one day in three.
 * The limit is a sanity bound, not a paywall: 100 singles and 20 bundles a day
 * is far past any real session, and matches how `ember_bundle` was originally
 * seeded before it was deliberately tightened.
 *
 * ## Two tables, as always
 *
 * `daily_shop_config` is what future days generate from; `purchaseItem` charges
 * `daily_shop_offerings.price`. Today's already-generated rows have to move too
 * or the old price keeps selling until midnight. Scoped to
 * `shop_date >= CURRENT_DATE` so historical offerings keep what they sold at.
 *
 * The `pack_bundle_10` offering row is NOT inserted here — `generateDailyShop`
 * creates it on the next rotation. Backfilling it would mean duplicating the
 * slot-numbering logic; the bundle simply appears tomorrow, while the repriced
 * `pack` slot is correct immediately.
 *
 * Release-safety: prices and labels are read from the API, and an old client
 * that does not recognise `pack_bundle_10` skips the offering shape rather than
 * failing. Fully reversible.
 */

exports.shorthands = undefined;

exports.disableTransaction = false;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  // The single pack: back to gems, and effectively unlimited.
  pgm.sql(`
    UPDATE daily_shop_config
       SET price = 100,
           currency = 'gems',
           daily_limit = 100,
           daily_availability = 1,
           is_active = true,
           updated_at = NOW()
     WHERE item_type = 'pack';
  `);

  pgm.sql(`
    UPDATE daily_shop_offerings
       SET price = 100,
           currency = 'gems'
     WHERE item_type = 'pack'
       AND shop_date >= CURRENT_DATE;
  `);

  // The ten-pack bundle.
  pgm.sql(`
    INSERT INTO daily_shop_config
      (item_type, daily_limit, price, currency, daily_availability, is_active, reset_price_gems)
    VALUES
      ('pack_bundle_10', 20, 900, 'gems', 1, true, 0)
    ON CONFLICT (item_type) DO UPDATE
      SET daily_limit = EXCLUDED.daily_limit,
          price = EXCLUDED.price,
          currency = EXCLUDED.currency,
          daily_availability = EXCLUDED.daily_availability,
          is_active = EXCLUDED.is_active,
          reset_price_gems = EXCLUDED.reset_price_gems,
          updated_at = NOW();
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  // Restore the fragment pricing 1799000000009 established.
  pgm.sql(`
    UPDATE daily_shop_config
       SET price = 150,
           currency = 'card_fragments',
           daily_limit = 10,
           updated_at = NOW()
     WHERE item_type = 'pack';
  `);

  pgm.sql(`
    UPDATE daily_shop_offerings
       SET price = 150,
           currency = 'card_fragments'
     WHERE item_type = 'pack'
       AND shop_date >= CURRENT_DATE;
  `);

  // Drop the bundle's offerings before its config: offerings reference the
  // config row's item_type, and leaving them would keep a purchasable slot
  // alive for an item the shop no longer generates.
  pgm.sql(`
    DELETE FROM daily_shop_offerings
     WHERE item_type = 'pack_bundle_10'
       AND shop_date >= CURRENT_DATE;
  `);

  pgm.sql(`
    DELETE FROM daily_shop_config WHERE item_type = 'pack_bundle_10';
  `);
};
