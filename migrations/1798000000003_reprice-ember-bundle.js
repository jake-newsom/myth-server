/* eslint-disable camelcase */

/**
 * Reprices the daily shop's ember bundle from 100 to 300 gems per 60 embers.
 *
 * Two rows have to move, not one:
 *
 *   1. `daily_shop_config` — the definition every future day is generated from.
 *
 *   2. `daily_shop_offerings` — the offerings for TODAY (and any future date
 *      already generated). `generateFlatOffering` copies `config.price` into
 *      the offering at generation time, and DailyShopService.purchaseItem
 *      charges `offering.price`, NOT the config price. Repricing the config
 *      alone would leave the already-generated offering selling at 100 gems
 *      until the next midnight rotation.
 *
 * Scoped to `shop_date >= CURRENT_DATE` so historical offerings keep the price
 * they actually sold at — past `daily_shop_purchases` rows record their own
 * `total_cost`, and rewriting old offerings would make the shop's history
 * disagree with what players were charged.
 *
 * The bundle amount itself (60 embers) is not stored here — it comes from
 * EMBER_CONFIG.SHOP_BUNDLE_AMOUNT in application code, so only the price is a
 * data change.
 *
 * Release-safety: this is a price change on an item nothing has shipped a
 * hardcoded price for. The client reads `offering.price` off the API and
 * renders whatever it is told, so old clients display 300 correctly with no
 * update.
 */

exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.sql(`
    UPDATE daily_shop_config
       SET price = 300,
           updated_at = NOW()
     WHERE item_type = 'ember_bundle';
  `);

  pgm.sql(`
    UPDATE daily_shop_offerings
       SET price = 300
     WHERE item_type = 'ember_bundle'
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
           updated_at = NOW()
     WHERE item_type = 'ember_bundle';
  `);

  pgm.sql(`
    UPDATE daily_shop_offerings
       SET price = 100
     WHERE item_type = 'ember_bundle'
       AND shop_date >= CURRENT_DATE;
  `);
};
