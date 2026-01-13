/**
 * Create characters table to store mythological character data
 * Characters hold shared data (name, description, power, ability, tags)
 * that can be referenced by multiple card variants
 * 
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  pgm.createTable("characters", {
    character_id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("uuid_generate_v4()"),
    },
    name: {
      type: "varchar(100)",
      notNull: true,
    },
    description: {
      type: "text",
      notNull: false,
    },
    type: {
      type: "varchar(50)",
      notNull: true,
    },
    base_power: {
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
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
    updated_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  // Create indexes for common queries
  pgm.createIndex("characters", "name");
  pgm.createIndex("characters", "set_id");
  pgm.createIndex("characters", "special_ability_id");
  pgm.createIndex("characters", "type");
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.dropTable("characters");
};

