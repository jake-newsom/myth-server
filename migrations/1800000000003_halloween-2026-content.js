/**
 * Halloween 2026 content: milestone ladder + expanded shop.
 *
 * Adds the event's cosmetics and exclusive cards, five currency milestones,
 * and the shop's card/border/back slots. Configuration only — no schema.
 *
 * ## Card art
 *
 * The ten exclusive variants REUSE existing underworld art (see `image_url`
 * below) so nothing 404s and the event is demoable today. They are real
 * `is_exclusive` variants with `halloween_2026_*` slugs, so swapping in bespoke
 * art later is a one-column UPDATE per row and needs no migration.
 *
 * ## Border and back
 *
 * These point at placeholder paths (`halloween/…`) that do not exist yet, per
 * the decision to add the real assets later. They are otherwise complete rows;
 * dropping the files in is all that remains.
 *
 * ## Economy
 *
 * Milestones are the main track. A steady player earning ~35% × ~17 Candy per
 * match plus the ~1,100 from the login ladder lands near 3,000-3,500 over the
 * nine days, so the ladder tops out at 3,000 and pays out most of that
 * automatically; the shop is where the remainder is spent by choice.
 */

exports.up = (pgm) => {
  // ---- Cosmetics -----------------------------------------------------------
  //
  // Placeholder art paths: the rows are complete, the images are not yet.
  pgm.sql(`
    INSERT INTO card_borders (name, description, image_url, is_active)
    SELECT 'Hallowed Veil',
           'Awarded during Hallow''s Eve 2026.',
           'halloween/hallowed-veil-border.webp',
           true
     WHERE NOT EXISTS (SELECT 1 FROM card_borders WHERE name = 'Hallowed Veil');
  `);

  pgm.sql(`
    INSERT INTO card_backs (code_key, name, description, image_url, is_active)
    VALUES ('halloween-2026-back', 'Jack''s Lantern',
            'Awarded during Hallow''s Eve 2026.',
            'halloween/jacks-lantern-back.webp', true)
    ON CONFLICT (code_key) DO NOTHING;
  `);

  // ---- Exclusive variants --------------------------------------------------
  //
  // Ten Hallow's Eve variants: five for the milestone ladder, five for the
  // shop. Each reuses an existing underworld artwork for now.
  pgm.sql(`
    INSERT INTO card_variants
      (character_id, rarity, image_url, slug, is_exclusive, description, released_at)
    SELECT ch.character_id, v.rarity, v.image_url, v.slug, true, v.description, now()
      FROM (VALUES
        -- Milestone rewards
        ('Nightmarchers', 'rare+++',     'polynesian/nightmarchers.webp',        'halloween_2026_nightmarchers',  'Hallow''s Eve 2026'),
        ('Milu',          'epic+',       'polynesian/milu.webp',                 'halloween_2026_milu',           'Hallow''s Eve 2026'),
        ('Gashadokuro',   'epic++',      'japanese/gashadokuro.webp',            'halloween_2026_gashadokuro',    'Hallow''s Eve 2026'),
        ('Hel',           'legendary+',  'norse/hel.webp',                       'halloween_2026_hel',            'Hallow''s Eve 2026'),
        ('Hel',           'legendary++', 'norse/rare/hel-3.webp',                'halloween_2026_hel_veiled',     'Hallow''s Eve 2026'),
        -- Shop cards
        ('Nightmarchers', 'rare++',      'polynesian/rare/nightmarchers-1.webp', 'halloween_2026_nightmarchers_s','Hallow''s Eve 2026'),
        ('Milu',          'epic++',      'polynesian/rare/milu-1.webp',          'halloween_2026_milu_s',         'Hallow''s Eve 2026'),
        ('Gashadokuro',   'epic+++',     'japanese/rare/gashadokuro-1.webp',     'halloween_2026_gashadokuro_s',  'Hallow''s Eve 2026'),
        ('Milu',          'epic+++',     'polynesian/rare/milu-2.webp',          'halloween_2026_milu_veiled',    'Hallow''s Eve 2026'),
        ('Hel',           'legendary+++','norse/rare/hel-6.webp',                'halloween_2026_hel_shop',       'Hallow''s Eve 2026')
      ) AS v(character_name, rarity, image_url, slug, description)
      JOIN characters ch ON ch.name = v.character_name
    -- The slug unique index is PARTIAL (WHERE slug IS NOT NULL), so the
    -- conflict target must repeat that predicate to match it.
    ON CONFLICT (slug) WHERE slug IS NOT NULL DO NOTHING;
  `);

  // ---- Milestones ----------------------------------------------------------
  //
  // Five rungs against total Candy EARNED. Thresholds climb 250 -> 3000, each
  // paying a resource bundle plus one exclusive card.
  pgm.sql(`
    INSERT INTO event_milestones
      (event_id, threshold, name, description,
       reward_gems, reward_card_fragments, reward_packs, reward_gold,
       reward_card_variant_id, reward_border_id, reward_card_back_id, sort_order)
    SELECT e.id, v.threshold, v.name, v.description,
           v.gems, v.fragments, v.packs, v.gold,
           (SELECT card_variant_id FROM card_variants WHERE slug = v.card_slug),
           CASE WHEN v.border THEN (SELECT border_id FROM card_borders WHERE name = 'Hallowed Veil') END,
           CASE WHEN v.back   THEN (SELECT back_id FROM card_backs WHERE code_key = 'halloween-2026-back') END,
           v.threshold
      FROM events e
      CROSS JOIN (VALUES
        (250,  'First Harvest',  'Earn 250 Candy.',   25,  10, 0, 1000,
         'halloween_2026_nightmarchers', false, false),
        (750,  'Wandering Souls','Earn 750 Candy.',   50,  25, 1, 0,
         'halloween_2026_milu',          false, false),
        (1500, 'The Long Night', 'Earn 1,500 Candy.', 100, 50, 1, 2500,
         'halloween_2026_gashadokuro',   true,  false),
        (2250, 'Veilbreaker',    'Earn 2,250 Candy.', 150, 75, 2, 0,
         'halloween_2026_hel',           false, true),
        (3000, 'Hallowed',       'Earn 3,000 Candy.', 250, 100, 3, 5000,
         'halloween_2026_hel_veiled',    false, false)
      ) AS v(threshold, name, description, gems, fragments, packs, gold,
             card_slug, border, back)
     WHERE e.event_key = 'halloween-2026'
    ON CONFLICT (event_id, threshold) DO NOTHING;
  `);

  // ---- Shop: exclusive cards ----------------------------------------------
  //
  // Slots 7 and 8 already hold two card offerings from the initial seed; these
  // retarget them onto the new exclusive variants and add three more, so the
  // shop's cards are Hallow's Eve art rather than ordinary catalogue cards.
  pgm.sql(`
    UPDATE event_shop_offerings o
       SET grant_card_variant_id = (SELECT card_variant_id FROM card_variants WHERE slug = 'halloween_2026_hel_shop')
     WHERE o.slot_number = 8
       AND o.event_id = (SELECT id FROM events WHERE event_key = 'halloween-2026');

    UPDATE event_shop_offerings o
       SET grant_card_variant_id = (SELECT card_variant_id FROM card_variants WHERE slug = 'halloween_2026_gashadokuro_s')
     WHERE o.slot_number = 7
       AND o.event_id = (SELECT id FROM events WHERE event_key = 'halloween-2026');
  `);

  pgm.sql(`
    INSERT INTO event_shop_offerings
      (event_id, slot_number, item_type, grant_card_variant_id, grant_amount,
       price, price_currency, purchase_limit, sort_order)
    SELECT e.id, v.slot, 'card',
           (SELECT card_variant_id FROM card_variants WHERE slug = v.slug),
           1, v.price, 'event', 1, v.sort
      FROM events e
      CROSS JOIN (VALUES
        (9,  'halloween_2026_milu_veiled',     1200, 2),
        (10, 'halloween_2026_milu_s',          700,  3),
        (11, 'halloween_2026_nightmarchers_s', 450,  4)
      ) AS v(slot, slug, price, sort)
     WHERE e.event_key = 'halloween-2026'
    ON CONFLICT (event_id, slot_number) DO NOTHING;
  `);

  // ---- Shop: cosmetics + extra resources ----------------------------------
  pgm.sql(`
    INSERT INTO event_shop_offerings
      (event_id, slot_number, item_type, grant_border_id, grant_card_back_id,
       grant_amount, price, price_currency, purchase_limit, sort_order)
    SELECT e.id, 12, 'border',
           (SELECT border_id FROM card_borders WHERE name = 'Hallowed Veil'),
           NULL, 1, 1500, 'event', 1, 5
      FROM events e WHERE e.event_key = 'halloween-2026'
    ON CONFLICT (event_id, slot_number) DO NOTHING;
  `);

  pgm.sql(`
    INSERT INTO event_shop_offerings
      (event_id, slot_number, item_type, grant_card_back_id, grant_amount,
       price, price_currency, purchase_limit, sort_order)
    SELECT e.id, 13, 'card_back',
           (SELECT back_id FROM card_backs WHERE code_key = 'halloween-2026-back'),
           1, 1500, 'event', 1, 6
      FROM events e WHERE e.event_key = 'halloween-2026'
    ON CONFLICT (event_id, slot_number) DO NOTHING;
  `);

  // Extra resource slots are BULK tiers, not duplicates: the initial seed
  // already sells single packs / 25 fragments / 50 gems, so these sit above
  // them as larger, better-value bundles for a player sitting on Candy.
  pgm.sql(`
    INSERT INTO event_shop_offerings
      (event_id, slot_number, item_type, grant_amount, price, price_currency,
       purchase_limit, sort_order)
    SELECT e.id, v.slot, v.item_type, v.amount, v.price, 'event', v.limit_count, v.sort
      FROM events e
      CROSS JOIN (VALUES
        (14, 'pack',           5,  1800, 2, 20),
        (15, 'card_fragments', 150, 1200, 2, 21),
        (16, 'gems',           250, 2400, 1, 22)
      ) AS v(slot, item_type, amount, price, limit_count, sort)
     WHERE e.event_key = 'halloween-2026'
    ON CONFLICT (event_id, slot_number) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM event_shop_offerings
     WHERE event_id = (SELECT id FROM events WHERE event_key = 'halloween-2026')
       AND slot_number >= 9;
    DELETE FROM event_milestones
     WHERE event_id = (SELECT id FROM events WHERE event_key = 'halloween-2026');
    DELETE FROM card_variants WHERE slug LIKE 'halloween_2026_%';
    DELETE FROM card_backs WHERE code_key = 'halloween-2026-back';
    DELETE FROM card_borders WHERE name = 'Hallowed Veil';
  `);
};
