/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */

exports.up = (pgm) => {
  // Create custom type for the trigger moments
  pgm.createType("trigger_moment", [
    "OnPlace",
    "OnFlip",
    "OnFlipped",
    "OnTurnStart",
    "OnTurnEnd",
    "AnyOnFlip",
    "OnDefend",
    "AnyOnDefend",
    "HandOnFlip",
    "BoardOnFlip",
    "HandOnPlace",
    "BoardOnPlace",
    "BeforeCombat",
    "AfterCombat",
  ]);

  pgm.createTable("special_abilities", {
    ability_id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("uuid_generate_v4()"),
    },
    id: {
      type: "varchar(50)",
      notNull: true,
      unique: true,
    },
    name: {
      type: "varchar(100)",
      notNull: true,
    },
    description: {
      type: "text",
      notNull: true,
    },
    trigger_moment: {
      type: "trigger_moment",
      notNull: true,
    },
    parameters: {
      type: "jsonb",
      notNull: true,
    },
  });

  // Create index for fast lookup by id
  pgm.createIndex("special_abilities", "id");
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.dropIndex("special_abilities", "id");
  pgm.dropTable("special_abilities");
  pgm.dropType("trigger_moment");
};
