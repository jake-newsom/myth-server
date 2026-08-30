/* eslint-disable camelcase */

/**
 * Daily shop tuning:
 *
 *   1. The `pack` slot moves from 100 gems to 150 card fragments — a currency
 *      change as well as a price change.
 *   2. The `fate_coin_bundle` grants 2 fate coins instead of 5. That amount is
 *      NOT stored in the DB (SHOP_CONFIG.FATE_COIN_BUNDLE_AMOUNT in
 *      src/config/constants.ts), so it ships as a code change alongside this.
 *
 * As with the ember repricing (1798000000003), two tables have to move:
 * `daily_shop_config` (what future days are generated from) and
 * `daily_shop_offerings` for `shop_date >= CURRENT_DATE` — purchaseItem charges
 * `offering.price` / `offering.currency`, so today's already-generated slot
 * would otherwise keep selling at 100 gems until the next midnight rotation.
 * Past offerings keep the price they actually sold at.
 *
 * Release-safety: the client renders `offering.price` / `offering.currency`
 * straight off the API and already handles `card_fragments` (it is the currency
 * for soul cards), so shipped builds display this correctly with no update.
 */

exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.sql(`
    UPDATE daily_shop_config
       SET price = 150,
           currency = 'card_fragments',
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
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.sql(`
    UPDATE daily_shop_config
       SET price = 100,
           currency = 'gems',
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
};
