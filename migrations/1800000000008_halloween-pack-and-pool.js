/* eslint-disable camelcase */

/**
 * Hallow's Eve: ten more variants, and a real Halloween Pack to open them from.
 *
 * ## Why the pool grows from 10 to 20
 *
 * A Halloween Pack is five cards drawn only from the Halloween pool. Against a
 * ten-card pool, a player who reaches the 900-Candy milestone and buys the
 * shop's five packs opens 40+ cards and completes the set without trying, which
 * is the opposite of the intent that set completion stays a collector's chase.
 * Twenty variants keeps the early packs generous and the last few cards genuinely
 * hard to land.
 *
 * The ten additions follow the same rule as the original ten: an existing
 * underworld/spirit character reskinned at an exclusive rarity, pointing at
 * artwork that already exists in the repo. No new art is required to ship, and
 * a bespoke image can be swapped in per row later without touching this file.
 *
 * ## The pack
 *
 * `packs` + `pack_card_variants` already model "a pack and the variants it can
 * roll", and `PackService.getCardsFromPack` reads exactly that — so linking the
 * twenty Halloween variants to one pack row is all the contents logic needed.
 * What does NOT exist is per-pack inventory: `users.pack_count` is a single
 * untyped integer, so there is no way to hold "three Halloween packs". That is
 * added separately in 1800000000009.
 *
 * `is_released` is true so the pack resolves during the event; it is not part of
 * the standard rotation because nothing sells it outside the event surfaces.
 *
 * Idempotent throughout: variants conflict on the partial slug index, the pack
 * on its slug, and the links on their composite PK.
 */

exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  // Ten more Hallow's Eve variants, bringing the pool to twenty.
  pgm.sql(`
    INSERT INTO card_variants
      (character_id, rarity, image_url, slug, is_exclusive, description, released_at)
    SELECT ch.character_id, v.rarity, v.image_url, v.slug, true, v.description, now()
      FROM (VALUES
        ('Yuki-onna',      'rare++',      'japanese/rare/yuki-onna-1.webp',       'halloween_2026_yuki_onna',      'Hallow''s Eve 2026'),
        ('Yuki-onna',      'rare+++',     'japanese/rare/yuki-onna-2.webp',       'halloween_2026_yuki_onna_s',    'Hallow''s Eve 2026'),
        ('Noppera-bō',     'rare++',      'japanese/rare/noppera-bo-1.webp',      'halloween_2026_noppera_bo',     'Hallow''s Eve 2026'),
        ('Noppera-bō',     'rare+++',     'japanese/rare/noppera-bo-3.webp',      'halloween_2026_noppera_bo_s',   'Hallow''s Eve 2026'),
        ('Futakuchi-onna', 'rare++',      'japanese/rare/futakuchi-onna-1.webp',  'halloween_2026_futakuchi',      'Hallow''s Eve 2026'),
        ('Futakuchi-onna', 'rare+++',     'japanese/rare/futakuchi-onna-2.webp',  'halloween_2026_futakuchi_s',    'Hallow''s Eve 2026'),
        ('Nurarihyon',     'rare+++',     'japanese/rare/nurarihyon-1.webp',      'halloween_2026_nurarihyon',     'Hallow''s Eve 2026'),
        ('Yamabiko',       'rare++',      'japanese/rare/yamabiko-2.webp',        'halloween_2026_yamabiko',       'Hallow''s Eve 2026'),
        ('Kupua',          'epic++',      'polynesian/rare/kupua-3.webp',         'halloween_2026_kupua',          'Hallow''s Eve 2026'),
        ('Kupua',          'epic+++',     'polynesian/rare/kupua-4.webp',         'halloween_2026_kupua_s',        'Hallow''s Eve 2026')
      ) AS v(character_name, rarity, image_url, slug, description)
      JOIN characters ch ON ch.name = v.character_name
    -- The slug unique index is PARTIAL (WHERE slug IS NOT NULL), so the
    -- conflict target must repeat that predicate to match it.
    ON CONFLICT (slug) WHERE slug IS NOT NULL DO NOTHING;
  `);

  // The pack itself.
  pgm.sql(`
    INSERT INTO packs (name, slug, description, image_url, is_released, released_at, sort_order)
    VALUES (
      'Hallow''s Eve Pack',
      'halloween-2026-pack',
      'Five cards drawn from the Hallow''s Eve collection. Every card is Rare or better.',
      'halloween/hallows-eve-pack.webp',
      true,
      '2026-10-31 00:00:00+00', -- held back; patched live manually when the event opens
      100
    )
    ON CONFLICT (slug) DO NOTHING;
  `);

  // Link every Hallow's Eve variant to the pack.
  //
  // Equal weights: the pool is entirely rare-or-better by construction, so the
  // "Rare or better" guarantee needs no floor logic — there is nothing worse to
  // roll. Weighting is left flat rather than skewed toward the commons so the
  // legendaries stay findable; retune here if the chase proves too easy.
  pgm.sql(`
    INSERT INTO pack_card_variants (pack_id, card_variant_id, weight)
    SELECT p.pack_id, cv.card_variant_id, 100
      FROM packs p
      JOIN card_variants cv ON cv.slug LIKE 'halloween_2026%'
     WHERE p.slug = 'halloween-2026-pack'
    ON CONFLICT (pack_id, card_variant_id) DO NOTHING;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  // Links first (FK), then the pack, then only the variants this file added.
  pgm.sql(`
    DELETE FROM pack_card_variants
     WHERE pack_id IN (SELECT pack_id FROM packs WHERE slug = 'halloween-2026-pack');
  `);

  pgm.sql(`DELETE FROM packs WHERE slug = 'halloween-2026-pack';`);

  pgm.sql(`
    DELETE FROM card_variants
     WHERE slug IN (
       'halloween_2026_yuki_onna', 'halloween_2026_yuki_onna_s',
       'halloween_2026_noppera_bo', 'halloween_2026_noppera_bo_s',
       'halloween_2026_futakuchi', 'halloween_2026_futakuchi_s',
       'halloween_2026_nurarihyon', 'halloween_2026_yamabiko',
       'halloween_2026_kupua', 'halloween_2026_kupua_s'
     );
  `);
};
