/* eslint-disable camelcase */

/**
 * Puts rares on the daily tab's rotation and takes them off the Forge.
 *
 * ## Why both halves are one migration
 *
 * Rares previously appeared ONLY in the Soul Shop (Forge), which lists its
 * whole pool every day. Removing them there without adding them here would
 * leave a window with no reliable way to buy a specific rare at all, so the two
 * changes ship together. The Forge half is enforced in code — `SOUL_SHOP_PRICES`
 * no longer carries a `rare` entry, so `generateSoulShop` stops listing them —
 * and this migration only clears the rows already generated for future dates.
 *
 * ## Pricing
 *
 * 25 card fragments, continuing the rotation's halving curve: legendary 100,
 * epic 50, rare 25. Note this is BELOW the 50 rares cost in the Forge today;
 * the rotation asks a player to wait for a specific card to come around, and is
 * priced for that wait.
 *
 * ## Slots
 *
 * `daily_availability` 3, one per mythology, matching the legendary and epic
 * slots — `generateMythologyCards` and `generateRotatedMythologyCards` both
 * loop the three mythologies and advance a per-mythology cursor. The rotation
 * covers BASE-tier rares only (the pool query matches `rarity` exactly); the
 * `+/++/+++` variants continue to reach the shop through the two random
 * `enhanced_card` slots, which are unchanged.
 *
 * ## Release-safety
 *
 * Additive: a new offering row shape that shipped clients already render, since
 * the client keys a card tile off the presence of `card`, not off `item_type`.
 * Existing offerings, purchases and limits are untouched.
 *
 * Rollback WITHOUT a redeploy, since this ships unflagged:
 *   UPDATE daily_shop_config SET is_active = false WHERE item_type = 'rare_card';
 * The generator skips inactive configs, so the next rotation drops the slots.
 * To restore rares to the Forge as well, re-add `rare: 50` to SOUL_SHOP_PRICES.
 *
 * Only FUTURE offerings are cleared below. Today's rows are left alone so a
 * player mid-session does not have an offering vanish from under them.
 *
 * `disableTransaction`: these statements reference `rare_card`, the enum label
 * added by 1799000000005, which must be committed first.
 */

exports.shorthands = undefined;

// Required: references the enum value added by 1799000000005.
exports.disableTransaction = true;

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO daily_shop_config
      (item_type, daily_limit, price, currency, daily_availability, is_active, reset_price_gems)
    VALUES
      ('rare_card', 1, 25, 'card_fragments', 3, true, 0)
    ON CONFLICT (item_type) DO UPDATE
      SET daily_limit = EXCLUDED.daily_limit,
          price = EXCLUDED.price,
          currency = EXCLUDED.currency,
          daily_availability = EXCLUDED.daily_availability,
          is_active = EXCLUDED.is_active,
          reset_price_gems = EXCLUDED.reset_price_gems,
          updated_at = current_timestamp;
  `);

  // Rares are no longer part of the Forge. Future dates only: a shop already
  // generated for today keeps the offerings the player can currently see.
  pgm.sql(`
    DELETE FROM daily_shop_offerings
    WHERE item_type = 'soul_card'
      AND shop_date > CURRENT_DATE
      AND card_id IN (
        SELECT cv.card_variant_id
        FROM card_variants cv
        WHERE cv.rarity::text = 'rare'
      );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DELETE FROM daily_shop_offerings WHERE item_type = 'rare_card';`);
  pgm.sql(`DELETE FROM daily_shop_config WHERE item_type = 'rare_card';`);
};
