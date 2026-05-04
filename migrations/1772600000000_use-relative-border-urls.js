/**
 * Strip the `https://assets.myth-server` host prefix from `card_borders.image_url`.
 *
 * Border image paths are now stored as relative paths (e.g. `/borders/foo.webp`)
 * so that the consuming client can resolve them against whichever asset host
 * is appropriate per environment.
 *
 * Migrations `1772100000000_add-character-achievements` and
 * `1772200000000_add_character_set_achievement_milestones` were updated in
 * place to emit relative URLs. This migration cleans up rows that were
 * inserted by the previous (absolute-URL) versions of those migrations.
 *
 * On environments that have not yet run those seed migrations this is a pure
 * no-op (the WHERE clause matches zero rows).
 */

exports.shorthands = undefined;

const ABSOLUTE_PREFIX = "https://assets.myth-server";

exports.up = (pgm) => {
  pgm.sql(`
    UPDATE card_borders
    SET
      image_url = substring(image_url FROM ${ABSOLUTE_PREFIX.length + 1}),
      updated_at = NOW()
    WHERE image_url LIKE '${ABSOLUTE_PREFIX}/%';
  `);
};

exports.down = () => {
  // Intentionally a no-op. Restoring the hard-coded host prefix has no
  // operational value; the canonical seed data already lives in the prior
  // migrations.
};
