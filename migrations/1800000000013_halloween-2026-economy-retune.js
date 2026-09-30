/* eslint-disable camelcase */

/**
 * Hallow's Eve 2026: the full economy pass — dates, Candy earn rules, the
 * milestone track, and the Candy shop.
 *
 * Data only. Every mechanism it uses ships in 1800000000008-1800000000012.
 *
 * ## Dates: 9 days -> 31 days (start held at 2026-10-31, patched live manually; ends 2026-11-01)
 *
 * The milestone track tops out at 1,350 Candy, and the earn rules cap a day at
 * 45. The original 24 Oct - 2 Nov window is nine days, or 405 Candy at a
 * perfect grind — the 900 main track was not merely hard, it was arithmetically
 * unreachable. A month-long event is what those numbers were designed against.
 *
 * ## Earn rules
 *
 *   win 2 / draw 1 / loss 1 / forfeit 0, +5 on the first win of each UTC day,
 *   ordinary drops capped at 40/day.
 *
 * So 45/day at the ceiling, 1,395 over 31 days. Forfeits pay nothing so that
 * quitting is never the fast way to farm. The per-mode multipliers are dropped
 * to a flat 1.0: with fixed amounts, a 1.5x on PvP would mean 3 Candy a win
 * there against 2 in solo, quietly making the event a PvP grind. Every mode now
 * pays the same, and the cap is what bounds the day.
 *
 * Expected outcomes over 31 days:
 *
 *   caps every day        1,395   clears the 1,350 stretch
 *   ~30/day (active F2P)    930   clears the 900 main track
 *   ~15/day (casual)        465   clears through the 350 card milestone
 *
 * ## Milestones
 *
 * Main track ends at 900, stretch continues to 1,350. Two guaranteed Halloween
 * cards (350, 725), three Halloween Packs on the main track plus two in the
 * stretch, and the Hallowed Veil border at 900 as the completion reward. The
 * border is deliberately NOT sold in the shop: it is the one thing that says a
 * player finished the track.
 *
 * The old 250/750/1500/2250/3000 track is replaced outright rather than
 * extended — its thresholds were scaled to the lottery's much larger numbers
 * and none of them survive the retune. Claims against the old rows are deleted
 * with them; the event has not run, so nothing has been claimed in production.
 *
 * ## Shop
 *
 * Candy prices: Halloween Pack 100 (limit 5), three featured cards at 200/250/
 * 300 (limit 1 each), 10 Embers for 25 (limit 1/day -> capped at 31 for the
 * event, since purchase limits here are per-event not per-day), Standard Pack
 * 75 (limit 3), Fate Coin 75 (limit 2), 50 Fragments 100 (limit 2).
 *
 * Plus a gem-priced Halloween Pack at 150 gems, uncapped and separate from the
 * 5-pack Candy limit, and a ten-pack at 1,350 gems.
 *
 * Total Candy sink if a player buys everything: 500 + 750 + 775 + 225 + 150 +
 * 200 = well past what even a perfect grind earns, so the shop stays a set of
 * choices rather than a checklist.
 *
 * ## The one compromise
 *
 * "10 Embers for 25 Candy, limit 1/day" cannot be expressed exactly:
 * `event_shop_offerings.purchase_limit` is per-event, not per-day. It is set to
 * 31 (one per day of the event), which allows the same total but lets a player
 * take them all at once. Called out rather than silently approximated; a true
 * per-day limit would need a new column and a daily counter.
 */

exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  // ---- Dates and earn rules ------------------------------------------------
  pgm.sql(`
    UPDATE events
       SET starts_at = '2026-10-31 00:00:00+00',
           ends_at   = '2026-11-01 00:00:00+00',
           currency_win_amount      = 2,
           currency_draw_amount     = 1,
           currency_loss_amount     = 1,
           currency_forfeit_amount  = 0,
           currency_first_win_bonus = 5,
           currency_daily_cap       = 40,
           -- Flat across modes: fixed amounts plus a per-mode multiplier would
           -- make one mode strictly better to grind.
           currency_drop_mode_multipliers = '{}'::jsonb
     WHERE event_key = 'halloween-2026';
  `);

  // Keep the login sequence inside the new window.
  pgm.sql(`
    UPDATE login_sequences
       SET starts_at = '2026-10-31 00:00:00+00',
           ends_at   = '2026-11-01 00:00:00+00'
     WHERE sequence_key = 'halloween-2026-login';
  `);

  // ---- Milestones ----------------------------------------------------------
  // Replace the old track wholesale; its thresholds were scaled to the lottery.
  pgm.sql(`
    DELETE FROM user_event_milestone_claims
     WHERE milestone_id IN (
       SELECT m.id FROM event_milestones m
         JOIN events e ON e.id = m.event_id
        WHERE e.event_key = 'halloween-2026'
     );
  `);
  pgm.sql(`
    DELETE FROM event_milestones
     WHERE event_id IN (SELECT id FROM events WHERE event_key = 'halloween-2026');
  `);

  pgm.sql(`
    INSERT INTO event_milestones
      (event_id, threshold, name, description,
       reward_gold, reward_gems, reward_fate_coins, reward_card_fragments,
       reward_packs, reward_embers,
       reward_card_variant_id, reward_border_id, reward_card_back_id,
       reward_pack_id, reward_pack_quantity, sort_order)
    SELECT e.id, v.threshold, v.name, v.description,
           0, 0, v.fate_coins, v.fragments,
           v.packs, v.embers,
           cv.card_variant_id, b.border_id, NULL,
           hp.pack_id, v.event_packs, v.sort_order
      FROM events e
      CROSS JOIN (VALUES
        ( 25, 'Trick or Treat',   'The veil thins.',                    0,   0, 0, 10, NULL,                        false, 0, 1),
        ( 75, 'Candy Bucket',     'A standard pack for the collection.',0,   0, 1,  0, NULL,                        false, 0, 2),
        (150, 'Haunted Haul',     'A Hallow''s Eve pack.',              0,   0, 0,  0, NULL,                        false, 1, 3),
        (250, 'Grave Offerings',  '50 card fragments.',                 0,  50, 0,  0, NULL,                        false, 0, 4),
        (350, 'The First Veil',   'A guaranteed Hallow''s Eve card.',   0,   0, 0,  0, 'halloween_2026_nightmarchers', false, 0, 5),
        (475, 'Midnight Hoard',   'A Hallow''s Eve pack.',              0,   0, 0,  0, NULL,                        false, 1, 6),
        (600, 'Fate and Ash',     'A fate coin and 25 fragments.',      1,  25, 0,  0, NULL,                        false, 0, 7),
        (725, 'The Second Veil',  'A guaranteed Hallow''s Eve card.',   0,   0, 0,  0, 'halloween_2026_gashadokuro',  false, 0, 8),
        (825, 'All Hallows',      'A Hallow''s Eve pack.',              0,   0, 0,  0, NULL,                        false, 1, 9),
        (900, 'Hallowed Veil',    'The Hallow''s Eve border.',          0,   0, 0,  0, NULL,                        true,  0, 10),
        -- Stretch
        (1050, 'Beyond the Veil', 'A Hallow''s Eve pack.',              0,   0, 0,  0, NULL,                        false, 1, 11),
        (1200, 'Bone Harvest',    '100 card fragments.',                0, 100, 0,  0, NULL,                        false, 0, 12),
        (1350, 'Lord of the Dead','A Hallow''s Eve pack.',              0,   0, 0,  0, NULL,                        false, 1, 13)
      ) AS v(threshold, name, description, fate_coins, fragments, packs, embers,
             card_slug, wants_border, event_packs, sort_order)
      LEFT JOIN card_variants cv ON cv.slug = v.card_slug
      LEFT JOIN card_borders b
             ON v.wants_border AND b.image_url = 'halloween/hallowed-veil-border.webp'
      LEFT JOIN packs hp ON hp.slug = 'halloween-2026-pack' AND v.event_packs > 0
     WHERE e.event_key = 'halloween-2026';
  `);

  // ---- Shop ----------------------------------------------------------------
  pgm.sql(`
    DELETE FROM event_shop_purchases
     WHERE offering_id IN (
       SELECT o.id FROM event_shop_offerings o
         JOIN events e ON e.id = o.event_id
        WHERE e.event_key = 'halloween-2026'
     );
  `);
  pgm.sql(`
    DELETE FROM event_shop_offerings
     WHERE event_id IN (SELECT id FROM events WHERE event_key = 'halloween-2026');
  `);

  pgm.sql(`
    INSERT INTO event_shop_offerings
      (event_id, slot_number, item_type,
       grant_card_variant_id, grant_border_id, grant_card_back_id, grant_pack_id,
       grant_amount, price, price_currency, purchase_limit, is_active, sort_order)
    SELECT e.id, v.slot, v.item_type,
           cv.card_variant_id, NULL, NULL,
           CASE WHEN v.item_type = 'event_pack' THEN hp.pack_id END,
           v.amount, v.price, v.currency, v.limit_, true, v.slot
      FROM events e
      CROSS JOIN (VALUES
        -- Candy: the event pack, the headline sink.
        (1,  'event_pack',     NULL,                            1,  100, 'event',  5),
        -- Candy: three featured guaranteed cards.
        (2,  'card',           'halloween_2026_hel',            1,  200, 'event',  1),
        (3,  'card',           'halloween_2026_milu_veiled',    1,  250, 'event',  1),
        (4,  'card',           'halloween_2026_hel_veiled',     1,  300, 'event',  1),
        -- Candy: reinvest into normal progression. purchase_limit is per-event,
        -- so 31 is "one a day" expressed as a total (see the header note).
        (5,  'embers',         NULL,                           10,   25, 'event', 31),
        -- Candy: evergreen resources.
        (6,  'pack',           NULL,                            1,   75, 'event',  3),
        (7,  'fate_coins',     NULL,                            1,   75, 'event',  2),
        (8,  'card_fragments', NULL,                           50,  100, 'event',  2),
        -- Gems: uncapped, and separate from the 5-pack Candy limit.
        (9,  'event_pack',     NULL,                            1,  150, 'gems',  NULL),
        (10, 'event_pack',     NULL,                           10, 1350, 'gems',  NULL)
      ) AS v(slot, item_type, card_slug, amount, price, currency, limit_)
      LEFT JOIN card_variants cv ON cv.slug = v.card_slug
      LEFT JOIN packs hp ON hp.slug = 'halloween-2026-pack'
     WHERE e.event_key = 'halloween-2026';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  // Restore the original window and the lottery drop rules.
  pgm.sql(`
    UPDATE events
       SET starts_at = '2026-10-24 00:00:00+00',
           ends_at   = '2026-11-02 00:00:00+00',
           currency_win_amount      = 0,
           currency_draw_amount     = 0,
           currency_loss_amount     = 0,
           currency_forfeit_amount  = 0,
           currency_first_win_bonus = 0,
           currency_daily_cap       = 0,
           currency_drop_mode_multipliers =
             '{"pvp": 1.5, "ranked_draft": 1.5, "solo": 1.0}'::jsonb
     WHERE event_key = 'halloween-2026';
  `);

  pgm.sql(`
    UPDATE login_sequences
       SET starts_at = '2026-10-24 00:00:00+00',
           ends_at   = '2026-11-02 00:00:00+00'
     WHERE sequence_key = 'halloween-2026-login';
  `);

  // The retuned rows go; 1800000000002 and _004 own the original track and
  // shop, so re-running those is how the old content comes back.
  pgm.sql(`
    DELETE FROM user_event_milestone_claims
     WHERE milestone_id IN (
       SELECT m.id FROM event_milestones m
         JOIN events e ON e.id = m.event_id
        WHERE e.event_key = 'halloween-2026'
     );
  `);
  pgm.sql(`
    DELETE FROM event_milestones
     WHERE event_id IN (SELECT id FROM events WHERE event_key = 'halloween-2026');
  `);
  pgm.sql(`
    DELETE FROM event_shop_purchases
     WHERE offering_id IN (
       SELECT o.id FROM event_shop_offerings o
         JOIN events e ON e.id = o.event_id
        WHERE e.event_key = 'halloween-2026'
     );
  `);
  pgm.sql(`
    DELETE FROM event_shop_offerings
     WHERE event_id IN (SELECT id FROM events WHERE event_key = 'halloween-2026');
  `);
};
