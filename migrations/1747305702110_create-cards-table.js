/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  // Create custom type for card rarity
  pgm.createType("card_rarity", [
    "common",
    "uncommon",
    "rare",
    "epic",
    "legendary",
  ]);

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
      type: "card_rarity",
      notNull: true,
    },
    image_url: {
      type: "varchar(255)",
      notNull: true,
    },
    power: {
      type: "jsonb",
      notNull: true,
      comment: "JSON object with top, right, bottom, left power values",
    },
    special_ability_id: {
      type: "uuid",
      references: "special_abilities(ability_id)",
      onDelete: "SET NULL",
    },
    tags: {
      type: "text[]",
      notNull: true,
      default: "{}",
    },
    set_id: {
      type: "uuid",
      references: "sets(set_id)",
      onDelete: "RESTRICT",
      onUpdate: "CASCADE",
    },
  });

  // Create indexes for performance
  pgm.createIndex("cards", "set_id");
  pgm.createIndex("cards", "name");
  pgm.createIndex("cards", "rarity");
  pgm.createIndex("cards", "special_ability_id");
  pgm.createIndex("cards", "tags", { method: "gin" });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.dropIndex("cards", "tags");
  pgm.dropIndex("cards", "special_ability_id");
  pgm.dropIndex("cards", "rarity");
  pgm.dropIndex("cards", "name");
  pgm.dropIndex("cards", "set_id");
  pgm.dropTable("cards");
  pgm.dropType("card_rarity");
};
