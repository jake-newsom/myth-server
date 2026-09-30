/* eslint-disable camelcase */

/**
 * Economy rebalance: the daily shop's `fragment_bundle` moves from 150 gems to
 * 300 gems. The bundle still grants 150 fragments
 * (SHOP_CONFIG.FRAGMENT_BUNDLE_AMOUNT in src/config/constants.ts) — only the
 * price moves, so this is a migration with no code change alongside it.
 *
 * ## Why
 *
 * At 150 gems for 150 fragments the game pegged one gem to one fragment, which
 * made gems a frictionless route into the Forge — the one place fragments are
 * supposed to be the scarce, earned input. Doubling the price moves that peg to
 * 2:1 and makes converting gems straight into targeted progression genuinely
 * expensive, without touching Forge prices or any fragment faucet.
 *
 * ## Two tables have to move
 *
 * Same shape as the ember repricing (1798000000003) and the pack/fate-coin
 * repricing (1799000000009): `daily_shop_config` is what future days are
 * generated from, but `purchaseItem` charges `offering.price` off
 * `daily_shop_offerings`. Without the second statement today's already-generated
 * slot keeps selling at 150 until the next midnight rotation.
 *
 * Scoped to `shop_date >= CURRENT_DATE` so historical offerings keep the price
 * they actually sold at — those rows are the purchase ledger's context.
 *
 * ## Release-safety
 *
 * A price change on an item whose price the client never hardcodes: ShopView
 * renders `offering.price` straight off the API, and the grant amount it
 * displays comes from `offering.grant_amount`. Shipped builds show 300 gems /
 * 150 fragments with no update. Fully reversible — `down` restores 150.
 */

exports.shorthands = undefined;

exports.disableTransaction = false;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.sql(`
    UPDATE daily_shop_config
       SET price = 300,
           updated_at = NOW()
     WHERE item_type = 'fragment_bundle';
  `);

  pgm.sql(`
    UPDATE daily_shop_offerings
       SET price = 300
     WHERE item_type = 'fragment_bundle'
       AND shop_date >= CURRENT_DATE;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.sql(`
    UPDATE daily_shop_config
       SET price = 150,
           updated_at = NOW()
     WHERE item_type = 'fragment_bundle';
  `);

  pgm.sql(`
    UPDATE daily_shop_offerings
       SET price = 150
     WHERE item_type = 'fragment_bundle'
       AND shop_date >= CURRENT_DATE;
  `);
};
