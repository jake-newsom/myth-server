/**
 * Halloween 2026 — the first event built on the events system.
 *
 * Configuration only: it creates one event row and its attachments. No schema
 * changes, so it can be edited or reverted as data.
 *
 * ## Shape of the event
 *
 *   Window          2026-10-24 00:00 UTC -> 2026-11-02 00:00 UTC
 *   Currency        Candy ("candy"), dropping in every game mode
 *   Mechanic        `haunted` (already implemented in the engine registry),
 *                   surfaced as its own play-screen tile: "Haunted Grounds"
 *   Login sequence  7 rungs, standalone and reusable
 *   Shop            8 slots priced in Candy
 *   Achievements    3 event-scoped achievements, hidden outside the event
 *
 * ## Rollout / rollback
 *
 * The event is gated two ways:
 *   - `halloween-2026` grants EARLY access before Oct 24 (preview/QA only; it
 *     is not required once the window opens).
 *   - `halloween-2026-kill` hides the event even while live. Enabling that
 *     flag globally is the kill switch: it needs no deploy and no data edit.
 *
 * Both flags are created disabled. With them off and today's date outside the
 * window, this migration changes nothing a player can see.
 */

exports.up = (pgm) => {
  // ---- Flags ---------------------------------------------------------------
  pgm.sql(`
    INSERT INTO feature_flags (key, description, enabled_globally)
    VALUES
      ('halloween-2026',
       'Early access to the Halloween 2026 event before its start date. Not required once the event window opens.',
       false),
      ('halloween-2026-kill',
       'Kill switch: hides the Halloween 2026 event even during its live window.',
       false)
    ON CONFLICT (key) DO NOTHING;
  `);

  // ---- Currency ------------------------------------------------------------
  pgm.sql(`
    INSERT INTO event_currencies (currency_key, name, description)
    VALUES ('candy', 'Candy',
            'Collected from matches during Halloween. Spend it in the Halloween shop before the event ends.')
    ON CONFLICT (currency_key) DO NOTHING;
  `);

  // ---- Login sequence ------------------------------------------------------
  //
  // Seven rungs, climbing, with day 7 as the milestone. The window is one day
  // wider than the event on each side so a player logging in on the final
  // evening still banks their rung.
  pgm.sql(`
    INSERT INTO login_sequences (sequence_key, name, description, starts_at, ends_at)
    VALUES ('halloween-2026-login', 'Trick or Treat',
            'Log in during Halloween to climb the treat ladder.',
            '2026-10-24 00:00:00+00', '2026-11-02 00:00:00+00')
    ON CONFLICT (sequence_key) DO NOTHING;
  `);

  pgm.sql(`
    INSERT INTO login_sequence_rewards
      (sequence_id, day_index, reward_gold, reward_gems, reward_fate_coins,
       reward_card_fragments, reward_packs, reward_event_currency, is_milestone)
    SELECT s.id, v.day_index, v.gold, v.gems, v.fate_coins,
           v.fragments, v.packs, v.candy, v.milestone
      FROM login_sequences s
      CROSS JOIN (VALUES
        (1, 500,   0,  0,  0, 0,  50, false),
        (2,   0,  25,  0,  0, 0,  75, false),
        (3, 750,   0,  0, 10, 0, 100, false),
        (4,   0,   0,  5,  0, 1, 125, false),
        (5, 1000,  0,  0, 20, 0, 150, false),
        (6,   0,  50,  0,  0, 0, 200, false),
        (7,   0, 100, 10, 50, 2, 400, true)
      ) AS v(day_index, gold, gems, fate_coins, fragments, packs, candy, milestone)
     WHERE s.sequence_key = 'halloween-2026-login'
    ON CONFLICT (sequence_id, day_index) DO NOTHING;
  `);

  // ---- Event ---------------------------------------------------------------
  //
  // Drop rates: a ~35% base chance of 10-25 Candy. PvP and ranked draft pay a
  // premium (longer, harder matches); solo is the baseline. Tower/saga inherit
  // 1.0 by virtue of not appearing in the map.
  pgm.sql(`
    INSERT INTO events (
      event_key, name, description,
      starts_at, ends_at,
      preview_feature_flag_key, kill_switch_flag_key,
      currency_id, currency_drop_chance, currency_drop_min, currency_drop_max,
      currency_drop_mode_multipliers,
      login_sequence_id,
      mechanic_key, mechanic_config,
      theme_color,
      has_game_mode, game_mode_label, game_mode_description,
      sort_order
    )
    SELECT
      'halloween-2026', 'Hallow''s Eve',
      'The veil thins. Haunted ground spreads across the board, and Candy falls to those who fight on it.',
      '2026-10-24 00:00:00+00', '2026-11-02 00:00:00+00',
      'halloween-2026', 'halloween-2026-kill',
      c.id, 0.35, 10, 25,
      '{"pvp": 1.5, "ranked_draft": 1.5, "solo": 1.0}'::jsonb,
      s.id,
      'haunted', '{"tile_count": 5}'::jsonb,
      '#ff7518',
      true, 'Haunted Grounds',
      'Five haunted tiles. Underworld cards grow stronger on them; everything else withers.',
      0
    FROM event_currencies c
    CROSS JOIN login_sequences s
    WHERE c.currency_key = 'candy'
      AND s.sequence_key = 'halloween-2026-login'
    ON CONFLICT (event_key) DO NOTHING;
  `);

  // ---- Shop ----------------------------------------------------------------
  //
  // Priced against the drop rate: roughly 0.35 * ~17 Candy per match plus the
  // ~1100 from the login ladder puts the full board within reach of a steady
  // player over the nine days, with the legendary as the chase purchase.
  pgm.sql(`
    INSERT INTO event_shop_offerings
      (event_id, slot_number, item_type, grant_amount, price, price_currency,
       purchase_limit, sort_order)
    -- sort_order is v.slot + 10 so the two chase-card slots (sort_order 0 and
    -- 1, inserted below) lead the storefront and these fill in behind them.
    SELECT e.id, v.slot, v.item_type, v.amount, v.price, 'event', v.limit_count, v.slot + 10
      FROM events e
      CROSS JOIN (VALUES
        (1, 'pack',           1,  400, 5),
        (2, 'card_fragments', 25, 250, 10),
        (3, 'gems',           50, 600, 3),
        (4, 'fate_coins',     5,  350, 4),
        (5, 'gold',           2500, 200, 10),
        (6, 'embers',         3,  300, 5)
      ) AS v(slot, item_type, amount, price, limit_count)
     WHERE e.event_key = 'halloween-2026'
    ON CONFLICT (event_id, slot_number) DO NOTHING;
  `);

  // Two card slots: the event's thematic chase items. Resolved by lookup so
  // this works against any database that has the characters, and simply adds
  // no row if one is missing (rather than failing the migration).
  pgm.sql(`
    INSERT INTO event_shop_offerings
      (event_id, slot_number, item_type, grant_card_variant_id, grant_amount,
       price, price_currency, purchase_limit, sort_order)
    SELECT e.id, 7, 'card', cv.card_variant_id, 1, 900, 'event', 1, 1
      FROM events e
      CROSS JOIN LATERAL (
        SELECT cv.card_variant_id
          FROM card_variants cv
          JOIN characters ch ON ch.character_id = cv.character_id
         WHERE ch.name = 'Gashadokuro' AND cv.rarity = 'epic'
         LIMIT 1
      ) cv
     WHERE e.event_key = 'halloween-2026'
    ON CONFLICT (event_id, slot_number) DO NOTHING;
  `);

  pgm.sql(`
    INSERT INTO event_shop_offerings
      (event_id, slot_number, item_type, grant_card_variant_id, grant_amount,
       price, price_currency, purchase_limit, sort_order)
    SELECT e.id, 8, 'card', cv.card_variant_id, 1, 1800, 'event', 1, 0
      FROM events e
      CROSS JOIN LATERAL (
        SELECT cv.card_variant_id
          FROM card_variants cv
          JOIN characters ch ON ch.character_id = cv.character_id
         WHERE ch.name = 'Hel' AND cv.rarity = 'legendary'
         LIMIT 1
      ) cv
     WHERE e.event_key = 'halloween-2026'
    ON CONFLICT (event_id, slot_number) DO NOTHING;
  `);

  // ---- Event achievements --------------------------------------------------
  //
  // Ordinary `achievements` rows tagged with the event, so all existing
  // progress tracking and claiming applies unchanged. They are hidden outside
  // the event window by the visibility filter in achievement.service.
  //
  // NOTE: these use existing tracked categories/types. `haunted_*` progress
  // keys would need engine tracking to move on their own, so these are
  // deliberately scoped to counters that already increment (wins/games).
  pgm.sql(`
    INSERT INTO achievements
      (achievement_key, title, description, category, type, target_value,
       rarity, reward_gems, reward_packs, reward_event_currency,
       event_id, is_active, sort_order)
    SELECT v.key, v.title, v.description, v.category, v.type, v.target,
           v.rarity, v.gems, v.packs, v.candy, e.id, true, v.sort
      FROM events e
      CROSS JOIN (VALUES
        ('halloween_2026_first_night', 'First Night',
         'Win a game during Hallow''s Eve.', 'special', 'single', 1,
         'common', 25, 0, 150, 1),
        ('halloween_2026_haunting', 'A Proper Haunting',
         'Win 10 games during Hallow''s Eve.', 'special', 'progress', 10,
         'rare', 75, 1, 400, 2),
        ('halloween_2026_lord_of_the_veil', 'Lord of the Veil',
         'Win 25 games during Hallow''s Eve.', 'special', 'progress', 25,
         'epic', 150, 2, 900, 3)
      ) AS v(key, title, description, category, type, target, rarity, gems, packs, candy, sort)
     WHERE e.event_key = 'halloween-2026'
    ON CONFLICT (achievement_key) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM achievements WHERE achievement_key LIKE 'halloween_2026_%';
    DELETE FROM events WHERE event_key = 'halloween-2026';
    DELETE FROM login_sequences WHERE sequence_key = 'halloween-2026-login';
    DELETE FROM event_currencies WHERE currency_key = 'candy';
    DELETE FROM feature_flags WHERE key IN ('halloween-2026', 'halloween-2026-kill');
  `);
};
