/* eslint-disable camelcase */

/**
 * Daily-shop consumable configuration for the overhaul.
 *
 * ## Prices
 *
 * A pack already costs 100 gems through the "open 10" path
 * (`openMultiplePacks`: 100 gems each, 10% off at 10). The pack SLOT is priced
 * to match at 100 so the two ways to spend gems on a pack cannot be arbitraged
 * against each other — a player who buys the slot is not being punished or
 * rewarded relative to the button next to it.
 *
 * Fragments: the Soul Shop prices a common at 10 fragments, so a 150-fragment
 * bundle is 15 commons. At 150 gems that is 10 gems per common — deliberately
 * more expensive than pulling one, because the Soul Shop's value is CHOICE
 * (guaranteed specific card), not rate.
 *
 * Fate coins: 200 gems for 5 is 40 gems each. Fate picks cost 1 coin, so this
 * is priced above the free daily trickle without making coins a gem sink a
 * player feels obliged to buy.
 *
 * Embers: repriced only in `daily_limit`. The bundle stays 300 gems for 60
 * embers (set by 1798000000003) but is now capped at 3 buys a day instead of
 * the effectively-unlimited 100000. This is the one intentional TIGHTENING in
 * this release, and it is deliberate: an uncapped ember purchase let a player
 * convert gems into unlimited solo/tower games. It cannot break an old client —
 * the limit is enforced server-side and surfaced through `purchase_limits`,
 * which shipped clients already read.
 *
 * ## daily_limit vs daily_availability
 *
 * `daily_limit` is how many a single player may buy per day; `daily_availability`
 * is how many SLOTS are generated. Every consumable here is one slot bought
 * repeatedly, so availability is 1 and the limit carries the cap.
 *
 * `reset_price_gems` is 0 on all four: the paid reset is now a per-TAB action
 * (`shop_tab_resets`), not a per-item-type one. The old per-item reset path
 * stays in the code for the flag-off behaviour but is unreachable at 0.
 *
 * Idempotent: ON CONFLICT on the unique `item_type` constraint.
 *
 * ## Why this sets `disableTransaction`
 *
 * These INSERTs reference `fragment_bundle`, `fate_coin_bundle` and `soul_card`,
 * enum labels added by 1799000000000. Postgres refuses to let a statement use an
 * enum value whose adding transaction has not committed ("unsafe use of new
 * value ... New enum values must be committed before they can be used").
 *
 * Putting the ALTER TYPEs in their own FILE is not enough, and neither is
 * `disableTransaction` on both files: node-pg-migrate's `singleTransaction`
 * defaults to ON and wraps the entire RUN, so the ALTER TYPE still has not
 * committed when these INSERTs execute. See the long note in
 * 1799000000000_add-shop-overhaul-enum-values for the full mechanism.
 *
 * The run itself must pass `--no-single-transaction`. `render:start` therefore
 * calls `migrate:deploy`, and locally you want `npm run migrate:up:enum`.
 * `disableTransaction` is kept here as defence in depth, not as the fix.
 *
 * The cost of running outside a transaction is that a mid-migration failure
 * cannot roll back. That is acceptable here: every statement is an idempotent
 * upsert or a targeted UPDATE, so a partial run leaves valid rows and a re-run
 * converges to the same state.
 */

exports.shorthands = undefined;

// Required: these statements reference enum values added by 1799000000000,
// which must be committed first. See the note above.
exports.disableTransaction = true;

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO daily_shop_config
      (item_type, daily_limit, price, currency, daily_availability, is_active, reset_price_gems)
    VALUES
      ('pack', 10, 100, 'gems', 1, true, 0),
      ('fragment_bundle', 3, 150, 'gems', 1, true, 0),
      ('fate_coin_bundle', 2, 200, 'gems', 1, true, 0)
    ON CONFLICT (item_type) DO UPDATE
      SET daily_limit = EXCLUDED.daily_limit,
          price = EXCLUDED.price,
          currency = EXCLUDED.currency,
          daily_availability = EXCLUDED.daily_availability,
          is_active = EXCLUDED.is_active,
          reset_price_gems = EXCLUDED.reset_price_gems,
          updated_at = current_timestamp;
  `);

  // Embers keep their price; only the daily cap changes.
  pgm.sql(`
    UPDATE daily_shop_config
    SET daily_limit = 3,
        reset_price_gems = 0,
        updated_at = current_timestamp
    WHERE item_type = 'ember_bundle';
  `);

  // The Soul Shop is generated per-day from the card pool rather than from a
  // slot count, but purchase() still reads a config row for its currency and
  // per-card daily limit. One purchase of a given card per day.
  pgm.sql(`
    INSERT INTO daily_shop_config
      (item_type, daily_limit, price, currency, daily_availability, is_active, reset_price_gems)
    VALUES
      ('soul_card', 1, 10, 'card_fragments', 1, true, 0)
    ON CONFLICT (item_type) DO UPDATE
      SET daily_limit = EXCLUDED.daily_limit,
          currency = EXCLUDED.currency,
          is_active = EXCLUDED.is_active,
          updated_at = current_timestamp;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM daily_shop_offerings
    WHERE item_type IN ('fragment_bundle', 'fate_coin_bundle', 'soul_card');
  `);
  pgm.sql(`
    DELETE FROM daily_shop_config
    WHERE item_type IN ('fragment_bundle', 'fate_coin_bundle', 'soul_card');
  `);
  pgm.sql(`
    UPDATE daily_shop_config
    SET daily_limit = 100000, reset_price_gems = 0
    WHERE item_type = 'ember_bundle';
  `);
};
