/**
 * Create card_variants table to store visual variants of characters
 * Each variant has a unique image_url and rarity, but references a character
 * for shared data (name, description, power, ability, tags)
 * 
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  pgm.createTable("card_variants", {
    card_variant_id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("uuid_generate_v4()"),
    },
    character_id: {
      type: "uuid",
      notNull: true,
      references: "characters(character_id)",
      onDelete: "CASCADE",
    },
    rarity: {
      type: "varchar(20)",
      notNull: true,
    },
    image_url: {
      type: "varchar(255)",
      notNull: true,
    },
    attack_animation: {
      type: "varchar(100)",
      notNull: false,
    },
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  // Create indexes for common queries
  pgm.createIndex("card_variants", "character_id");
  pgm.createIndex("card_variants", "rarity");
  pgm.createIndex("card_variants", ["character_id", "rarity"]);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.dropTable("card_variants");
};

