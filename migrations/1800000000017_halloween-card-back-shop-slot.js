/* eslint-disable camelcase */

/**
 * Hallow's Eve 2026: sell the card back in the Candy shop.
 *
 * Data only. The `halloween-2026-back` card back is created in
 * 1800000000003, which also sold it in shop slot 13 and offered it on the
 * milestone track. The economy retune (1800000000013) rebuilt both the track
 * and the shop from scratch and carried neither forward, leaving the back
 * defined in `card_backs` but unobtainable. This puts it back, in the shop
 * only.
 *
 * ## Shop, not milestone
 *
 * The retune reserved the Hallowed Veil border as the 900 completion reward
 * and deliberately kept it out of the shop, so that owning it means finishing
 * the track. Putting the back on the track too would split that signal across
 * two cosmetics; selling it keeps the border as the only thing a player can't
 * buy.
 *
 * ## Price: 400 Candy, limit 1
 *
 * The retune's Candy sinks top out at 300 (the featured Veiled Hel). 400 sits
 * just above that as the most expensive single item in the shop, which is
 * where the one remaining cosmetic belongs. It is affordable on the ~30/day
 * active-F2P pace (930 over the event) but only by giving up most of a
 * featured card, so it stays a choice rather than a default purchase. It is
 * deliberately NOT priced against the old 1,500 from 1800000000003 — that
 * number was scaled to the pre-retune lottery track and nothing else in the
 * current shop is denominated against it.
 *
 * Slot 11: slots 1-10 are the retune's, so this appends rather than
 * renumbering anything a player may already have purchase rows against.
 */

exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO event_shop_offerings
      (event_id, slot_number, item_type,
       grant_card_variant_id, grant_border_id, grant_card_back_id, grant_pack_id,
       grant_amount, price, price_currency, purchase_limit, is_active, sort_order)
    SELECT e.id, 11, 'card_back',
           NULL, NULL, cb.back_id, NULL,
           1, 400, 'event', 1, true, 11
      FROM events e
      JOIN card_backs cb ON cb.code_key = 'halloween-2026-back'
     WHERE e.event_key = 'halloween-2026'
    ON CONFLICT (event_id, slot_number) DO NOTHING;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  // Only this slot: the rest of the shop belongs to 1800000000013.
  pgm.sql(`
    DELETE FROM event_shop_purchases
     WHERE offering_id IN (
       SELECT o.id FROM event_shop_offerings o
         JOIN events e ON e.id = o.event_id
        WHERE e.event_key = 'halloween-2026'
          AND o.slot_number = 11
          AND o.item_type = 'card_back'
     );
  `);
  pgm.sql(`
    DELETE FROM event_shop_offerings
     WHERE slot_number = 11
       AND item_type = 'card_back'
       AND event_id IN (SELECT id FROM events WHERE event_key = 'halloween-2026');
  `);
};
