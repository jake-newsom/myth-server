/**
 * Update user_owned_cards to reference card_variants instead of cards
 * 
 * This migration:
 * 1. Drops the existing foreign key constraint to cards
 * 2. Renames card_id column to card_variant_id
 * 3. Adds new foreign key constraint to card_variants
 * 
 * Note: The actual UUID values don't change - card_id values are preserved
 * as card_variant_id since we used the same UUIDs when creating variants
 * 
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  // Step 1: Drop the existing foreign key constraint to cards table
  pgm.dropConstraint("user_owned_cards", "user_owned_cards_card_id_fkey", {
    ifExists: true,
  });

  // Step 2: Rename the column from card_id to card_variant_id
  pgm.renameColumn("user_owned_cards", "card_id", "card_variant_id");

  // Step 3: Add new foreign key constraint to card_variants table
  pgm.addConstraint("user_owned_cards", "user_owned_cards_card_variant_id_fkey", {
    foreignKeys: {
      columns: "card_variant_id",
      references: "card_variants(card_variant_id)",
      onDelete: "CASCADE",
    },
  });

  // Step 4: Update the index (drop old, create new)
  pgm.dropIndex("user_owned_cards", "card_id", { ifExists: true });
  pgm.createIndex("user_owned_cards", "card_variant_id");
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Reverse the changes
  pgm.dropIndex("user_owned_cards", "card_variant_id", { ifExists: true });
  
  pgm.dropConstraint("user_owned_cards", "user_owned_cards_card_variant_id_fkey", {
    ifExists: true,
  });

  pgm.renameColumn("user_owned_cards", "card_variant_id", "card_id");

  pgm.addConstraint("user_owned_cards", "user_owned_cards_card_id_fkey", {
    foreignKeys: {
      columns: "card_id",
      references: "cards(card_id)",
      onDelete: "CASCADE",
    },
  });

  pgm.createIndex("user_owned_cards", "card_id");
};

