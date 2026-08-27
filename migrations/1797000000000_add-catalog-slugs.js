/**
 * Stable, environment-independent identities for characters and card_variants.
 *
 * Card definitions are authored in one place and pushed to several databases
 * (dev/staging and prod). Until now the only keys those rows had were UUIDs
 * generated independently per database, so the admin promote/clone tooling had
 * to match rows by `characters.name` and `(character_id, rarity)`. That is not
 * a key: 43 (character, rarity) pairs currently hold more than one variant --
 * Hel has three `legendary+` printings, Hachiman three `epic+` -- so promoting
 * picked one arbitrarily and overwrote it.
 *
 * `slug` gives both tables the same handle in every database, exactly as
 * `packs.slug` and `special_abilities.id` already do, so the catalog tooling
 * can match rows without ever comparing UUIDs or display names. Renaming a
 * character no longer forks it into a duplicate on the next push.
 *
 * Additive and backward-compatible per the release rules: the column is
 * nullable, nothing reads it yet, and the running server and shipped clients
 * are unaffected. It is safe to deploy this ahead of the tooling that uses it.
 *
 * Backfill is derived from data that is already unique and already identical
 * across environments, so both databases independently produce the same slugs:
 *   - characters    <- name                (91 rows -> 91 slugs, no collisions)
 *   - card_variants <- image_url           (290 rows -> 290 slugs, no collisions)
 *
 * `image_url` rather than the character/rarity pair because artwork is what
 * actually distinguishes two printings of the same card, and it is unique
 * across all 290 rows. The full path is used, not just the basename: six rows
 * collide on basename alone (`s1/benkei.webp` vs `japanese/benkei.webp`).
 *
 * The unique index is created after the backfill and is deliberately partial
 * (WHERE slug IS NOT NULL) so that legacy rows which somehow fail to slugify
 * are left NULL rather than blocking the migration. The dedupe pass below
 * should make that impossible, but prod may hold rows dev has never seen.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * Lowercase, strip accents, collapse everything else to single underscores.
 * Mirrors the JS slugify used by the admin catalog tooling -- the two must
 * agree, or a push would fail to match rows this migration created.
 *
 * `unaccent` is not assumed to be installed, so the accent folding is spelled
 * out for the characters actually present in the catalog (Jorōgumo, Kamapuaʻa,
 * Freyja, Ægir, Njörd...).
 */
const SLUGIFY = (expr) => `
  NULLIF(
    trim(both '_' from
      regexp_replace(
        lower(
          translate(
            ${expr},
            'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖØòóôõöøÙÚÛÜùúûüÝýÿÑñÇçÆæŌōŪūĀāĒēĪī',
            'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOOooooooUUUUuuuuYyyNnCcAaOoUuAaEeIi'
          )
        ),
        '[^a-z0-9]+', '_', 'g'
      )
    ),
    ''
  )
`;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.addColumn("characters", {
    slug: { type: "varchar(100)", notNull: false },
  });
  pgm.addColumn("card_variants", {
    slug: { type: "varchar(100)", notNull: false },
  });

  // --- characters: slug from name -----------------------------------------
  pgm.sql(`UPDATE characters SET slug = ${SLUGIFY("name")} WHERE slug IS NULL`);

  // --- card_variants: slug from image_url ---------------------------------
  // Strip the optional "assets/cards/" or "assets/" prefix and the file
  // extension, then slugify the remaining path. Path, not basename.
  pgm.sql(`
    UPDATE card_variants
    SET slug = ${SLUGIFY(`
      regexp_replace(
        regexp_replace(image_url, '^assets/(cards/)?', ''),
        '\\.[A-Za-z0-9]+$', ''
      )
    `)}
    WHERE slug IS NULL
  `);

  // --- collision guard ----------------------------------------------------
  // Verified collision-free on the current catalog, but prod may hold rows dev
  // does not. Any duplicate gets a deterministic `_2`, `_3`, ... suffix ordered
  // by created_at then primary key, so both databases resolve a shared
  // collision the same way instead of diverging.
  pgm.sql(`
    WITH ranked AS (
      SELECT character_id, slug,
             row_number() OVER (PARTITION BY slug ORDER BY created_at, character_id) AS rn
      FROM characters
      WHERE slug IS NOT NULL
    )
    UPDATE characters c
    SET slug = r.slug || '_' || r.rn
    FROM ranked r
    WHERE c.character_id = r.character_id AND r.rn > 1
  `);

  pgm.sql(`
    WITH ranked AS (
      SELECT card_variant_id, slug,
             row_number() OVER (PARTITION BY slug ORDER BY created_at, card_variant_id) AS rn
      FROM card_variants
      WHERE slug IS NOT NULL
    )
    UPDATE card_variants v
    SET slug = r.slug || '_' || r.rn
    FROM ranked r
    WHERE v.card_variant_id = r.card_variant_id AND r.rn > 1
  `);

  // Partial unique indexes: enforce identity where a slug exists, tolerate NULL.
  pgm.createIndex("characters", "slug", {
    unique: true,
    name: "characters_slug_unique",
    where: "slug IS NOT NULL",
  });
  pgm.createIndex("card_variants", "slug", {
    unique: true,
    name: "card_variants_slug_unique",
    where: "slug IS NOT NULL",
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropIndex("card_variants", "slug", { name: "card_variants_slug_unique" });
  pgm.dropIndex("characters", "slug", { name: "characters_slug_unique" });
  pgm.dropColumn("card_variants", "slug");
  pgm.dropColumn("characters", "slug");
};
