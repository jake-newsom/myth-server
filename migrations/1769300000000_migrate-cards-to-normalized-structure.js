/**
 * Migrate existing cards data to normalized characters + card_variants structure
 * 
 * This migration:
 * 1. Groups cards by shared attributes (name, type, power, ability, set, tags)
 * 2. Creates one character per unique combination
 * 3. Creates card_variants from existing cards, preserving original card_id as card_variant_id
 * 
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  // Step 1: Create characters from unique card attributes
  // Group by name, type, power, special_ability_id, set_id, and tags
  pgm.sql(`
    INSERT INTO characters (character_id, name, type, base_power, special_ability_id, set_id, tags, created_at, updated_at)
    SELECT 
      uuid_generate_v4() as character_id,
      name,
      type,
      power as base_power,
      special_ability_id,
      set_id,
      tags,
      NOW() as created_at,
      NOW() as updated_at
    FROM cards
    GROUP BY name, type, power, special_ability_id, set_id, tags
    ON CONFLICT DO NOTHING;
  `);

  // Step 2: Create card_variants from existing cards, preserving original card_id
  // Link each variant to its corresponding character
  pgm.sql(`
    INSERT INTO card_variants (card_variant_id, character_id, rarity, image_url, attack_animation, created_at)
    SELECT 
      c.card_id as card_variant_id,
      ch.character_id,
      c.rarity::text as rarity,
      c.image_url,
      c.attack_animation,
      NOW() as created_at
    FROM cards c
    JOIN characters ch ON 
      c.name = ch.name AND
      c.type = ch.type AND
      c.power = ch.base_power AND
      COALESCE(c.special_ability_id::text, '') = COALESCE(ch.special_ability_id::text, '') AND
      COALESCE(c.set_id::text, '') = COALESCE(ch.set_id::text, '') AND
      c.tags = ch.tags;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Clear the populated data (tables themselves are dropped by their own migrations)
  pgm.sql(`DELETE FROM card_variants;`);
  pgm.sql(`DELETE FROM characters;`);
};

