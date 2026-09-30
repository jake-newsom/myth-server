/* eslint-disable camelcase */

/**
 * Hallow's Eve: swap the placeholder pool for the final 23-card set.
 *
 * 1800000000003 / 1800000000008 seeded twenty `halloween_2026_*` variants that
 * reskinned existing art. The final set has bespoke art under
 * `halloween-2026/` (shipped in the client) and new `halloween-2026-*` slugs.
 *
 * Everything is keyed by natural keys, never UUIDs, so this runs identically on
 * any database: variants by slug, characters by name, the pack by slug,
 * milestones by threshold and shop offerings by slot number.
 *
 *   1. Upsert the 23 final variants (exclusive: event cards must never come
 *      out of generic pulls or random Forge crafts).
 *   2. Make them the Hallow's Eve pack's entire pool.
 *   3. Re-point the card milestones (350 / 725 / 1350) and the card shop slots
 *      (2 / 3 / 4) at final variants.
 *   4. Delete the placeholder variants nobody owns. Any owned copy (possible
 *      only via the preview flag) is left in place, just unlinked from the pack.
 *
 * Fails loudly if a character name doesn't resolve, rather than silently
 * shipping a short pool.
 */

exports.shorthands = undefined;

// [slug, character name, rarity, image_url]
const CARDS = [
  ["halloween-2026-bakeneko", "Bakeneko", "common+", "halloween-2026/bakeneko.webp"],
  ["halloween-2026-drengr", "Drengr", "common+", "halloween-2026/drengr.webp"],
  ["halloween-2026-fisherman", "Fisherman of Kuʻula", "common+", "halloween-2026/fisherman.webp"],
  ["halloween-2026-freya", "Freyja", "epic+", "halloween-2026/freya.webp"],
  ["halloween-2026-futakuchi", "Futakuchi-onna", "rare+", "halloween-2026/futakuchi.webp"],
  ["halloween-2026-gashadokuro", "Gashadokuro", "epic+", "halloween-2026/gashadokuro.webp"],
  ["halloween-2026-hel", "Hel", "legendary+", "halloween-2026/hel.webp"],
  ["halloween-2026-kaah", "Kaʻahupāhau", "epic+", "halloween-2026/kaah.webp"],
  ["halloween-2026-kane", "Kāne", "legendary+", "halloween-2026/kane.webp"],
  ["halloween-2026-kapo", "Kapo", "epic+", "halloween-2026/kapo.webp"],
  ["halloween-2026-maui", "Māui", "legendary+", "halloween-2026/maui.webp"],
  ["halloween-2026-milu", "Milu", "epic+", "halloween-2026/milu.webp"],
  ["halloween-2026-minamoto", "Minamoto no Raikō", "epic+", "halloween-2026/minamoto.webp"],
  ["halloween-2026-mokumokuren", "Mokumokuren", "common+", "halloween-2026/mokumokuren.webp"],
  ["halloween-2026-momotaro", "Momotarō", "epic+", "halloween-2026/momotaro.webp"],
  ["halloween-2026-nightmarchers", "Nightmarchers", "rare+", "halloween-2026/nightmarchers.webp"],
  ["halloween-2026-nopperabo", "Noppera-bō", "rare+", "halloween-2026/nopperabo.webp"],
  ["halloween-2026-nurarihyon", "Nurarihyon", "rare+", "halloween-2026/nurarihyon.webp"],
  ["halloween-2026-oni", "Oni", "common+", "halloween-2026/oni.webp"],
  ["halloween-2026-sigurd", "Sigurd", "rare+", "halloween-2026/sigurd.webp"],
  ["halloween-2026-susanoo", "Susanoo", "legendary+", "halloween-2026/susanoo.webp"],
  ["halloween-2026-tengu", "Tengu", "common+", "halloween-2026/tengu.webp"],
  ["halloween-2026-thor", "Thor", "legendary+", "halloween-2026/thor.webp"],
];

const MILESTONE_CARDS = [
  [350, "halloween-2026-nurarihyon"],
  [725, "halloween-2026-gashadokuro"],
  [1350, "halloween-2026-hel"],
];

const SHOP_CARDS = [
  [2, "halloween-2026-oni"],
  [3, "halloween-2026-kapo"],
  [4, "halloween-2026-susanoo"],
];

const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const rows = (list) => list.map((r) => `(${r.map((v) => (typeof v === "number" ? v : lit(v))).join(", ")})`).join(",\n        ");

exports.up = (pgm) => {
  // 1. Final variants. Guard first so a missing character aborts the deploy.
  pgm.sql(`
    DO $$
    DECLARE missing text;
    BEGIN
      SELECT string_agg(v.name, ', ') INTO missing
        FROM (VALUES ${CARDS.map((c) => `(${lit(c[1])})`).join(", ")}) AS v(name)
       WHERE NOT EXISTS (SELECT 1 FROM characters ch WHERE ch.name = v.name);
      IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'Hallow''s Eve set: unknown characters: %', missing;
      END IF;
    END $$;
  `);

  pgm.sql(`
    INSERT INTO card_variants
      (character_id, rarity, image_url, slug, is_exclusive, description, released_at)
    SELECT ch.character_id, v.rarity, v.image_url, v.slug, true, 'Hallow''s Eve 2026', now()
      FROM (VALUES
        ${rows(CARDS)}
      ) AS v(slug, character_name, rarity, image_url)
      JOIN characters ch ON ch.name = v.character_name
    ON CONFLICT (slug) WHERE slug IS NOT NULL DO UPDATE
      SET character_id = EXCLUDED.character_id,
          rarity = EXCLUDED.rarity,
          image_url = EXCLUDED.image_url,
          is_exclusive = true;
  `);

  // 2. The pack's pool is exactly the final set.
  const slugList = CARDS.map((c) => lit(c[0])).join(", ");
  pgm.sql(`
    DELETE FROM pack_card_variants pcv
     USING packs p, card_variants cv
     WHERE pcv.pack_id = p.pack_id
       AND cv.card_variant_id = pcv.card_variant_id
       AND p.slug = 'halloween-2026-pack'
       AND cv.slug NOT IN (${slugList});

    INSERT INTO pack_card_variants (pack_id, card_variant_id, weight)
    SELECT p.pack_id, cv.card_variant_id, 100
      FROM packs p
      JOIN card_variants cv ON cv.slug IN (${slugList})
     WHERE p.slug = 'halloween-2026-pack'
    ON CONFLICT (pack_id, card_variant_id) DO NOTHING;
  `);

  // 3. Milestone and shop card rewards.
  pgm.sql(`
    UPDATE event_milestones m
       SET reward_card_variant_id = cv.card_variant_id
      FROM events e, (VALUES ${rows(MILESTONE_CARDS)}) AS v(threshold, slug)
      JOIN card_variants cv ON cv.slug = v.slug
     WHERE m.event_id = e.id
       AND e.event_key = 'halloween-2026'
       AND m.threshold = v.threshold;

    UPDATE event_shop_offerings o
       SET grant_card_variant_id = cv.card_variant_id
      FROM events e, (VALUES ${rows(SHOP_CARDS)}) AS v(slot, slug)
      JOIN card_variants cv ON cv.slug = v.slug
     WHERE o.event_id = e.id
       AND e.event_key = 'halloween-2026'
       AND o.slot_number = v.slot
       AND o.item_type = 'card';
  `);

  // 4. Retire the placeholders. `\_` because `_` is a LIKE wildcard: an
  // unescaped 'halloween_2026%' would also match the final hyphenated slugs.
  pgm.sql(`
    DELETE FROM pack_card_variants pcv
     USING card_variants cv
     WHERE cv.card_variant_id = pcv.card_variant_id
       AND cv.slug LIKE 'halloween\\_2026\\_%';

    DELETE FROM card_variants cv
     WHERE cv.slug LIKE 'halloween\\_2026\\_%'
       AND NOT EXISTS (SELECT 1 FROM user_owned_cards u WHERE u.card_variant_id = cv.card_variant_id);
  `);
};

// Forward-only: the placeholder rows are gone and the final set is live data.
// Fix forward with another migration if the set needs to change.
exports.down = () => {};
