/**
 * Drop the legacy cards table after successful migration to normalized structure
 * 
 * IMPORTANT: Only run this after verifying:
 * 1. All card data has been migrated to characters + card_variants
 * 2. All queries have been updated to use the new tables
 * 3. The application is working correctly with the new structure
 * 
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  // Drop the legacy cards table
  // Note: This will also drop any foreign key constraints referencing this table
  pgm.dropTable("cards", { ifExists: true, cascade: true });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Recreate the cards table structure (without data - that would need to be restored from backup)
  pgm.createTable("cards", {
    card_id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("uuid_generate_v4()"),
    },
    name: {
      type: "varchar(100)",
      notNull: true,
    },
    type: {
      type: "varchar(50)",
      notNull: true,
    },
    rarity: {
      type: "varchar(20)",
      notNull: true,
    },
    image_url: {
      type: "varchar(255)",
      notNull: true,
    },
    power: {
      type: "jsonb",
      notNull: true,
    },
    special_ability_id: {
      type: "uuid",
      references: "special_abilities(ability_id)",
      onDelete: "SET NULL",
    },
    set_id: {
      type: "uuid",
      references: "sets(set_id)",
      onDelete: "SET NULL",
    },
    tags: {
      type: "text[]",
      notNull: true,
      default: "{}",
    },
    attack_animation: {
      type: "varchar(100)",
    },
    description: {
      type: "text",
    },
  });

  pgm.addConstraint("cards", "cards_name_key", { unique: ["name", "rarity"] });
};

