/* eslint-disable camelcase */

/**
 * Daily shop avatar frame slot.
 *
 * avatar_frames.daily_shop_price: non-null puts the frame in the daily
 * rotation pool at that gem price. One frame is picked per day
 * (DailyShopService.generateFrameOffering); with a single frame in the pool it
 * is always that one. Bifröst is the first.
 *
 * daily_shop_offerings.frame_id: which frame a day's avatar_frame slot sells.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE avatar_frames ADD COLUMN IF NOT EXISTS daily_shop_price integer
      CHECK (daily_shop_price IS NULL OR daily_shop_price > 0);
    ALTER TABLE daily_shop_offerings ADD COLUMN IF NOT EXISTS frame_id uuid
      REFERENCES avatar_frames(frame_id) ON DELETE CASCADE;

    UPDATE avatar_frames SET daily_shop_price = 800 WHERE code_key = 'bifrost';

    -- price is the fallback; each frame's daily_shop_price wins.
    INSERT INTO daily_shop_config
      (item_type, daily_limit, price, currency, daily_availability, is_active, reset_price_gems)
    SELECT 'avatar_frame', 1, 800, 'gems', 1, true, 0
     WHERE NOT EXISTS (SELECT 1 FROM daily_shop_config WHERE item_type = 'avatar_frame');
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM daily_shop_offerings WHERE item_type = 'avatar_frame';
    DELETE FROM daily_shop_config WHERE item_type = 'avatar_frame';
    ALTER TABLE daily_shop_offerings DROP COLUMN IF EXISTS frame_id;
    ALTER TABLE avatar_frames DROP COLUMN IF EXISTS daily_shop_price;
  `);
};
