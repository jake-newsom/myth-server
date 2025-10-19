/**
 * Migration to add user card power ups table
 * This table stores power up enhancements for user card instances
 * 
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  // Create user_card_power_ups table
  pgm.createTable("user_card_power_ups", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("uuid_generate_v4()"),
    },
    user_card_instance_id: {
      type: "uuid",
      notNull: true,
      references: "user_owned_cards(user_card_instance_id)",
      onDelete: "CASCADE",
      unique: true, // One power up record per card instance
    },
    power_up_count: {
      type: "integer",
      notNull: true,
      default: 0,
      check: "power_up_count >= 0",
    },
    power_up_data: {
      type: "jsonb",
      notNull: true,
      default: '{"top": 0, "bottom": 0, "left": 0, "right": 0}',
    },
    created_at: {
      type: "timestamp with time zone",
      notNull: true,
      default: pgm.func("now()"),
    },
    updated_at: {
      type: "timestamp with time zone",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  // Create index for faster lookups
  pgm.createIndex("user_card_power_ups", "user_card_instance_id");

  // Create function to update updated_at timestamp
  pgm.sql(`
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
        NEW.updated_at = now();
        RETURN NEW;
    END;
    $$ language 'plpgsql';
  `);

  // Create trigger to automatically update updated_at
  pgm.sql(`
    CREATE TRIGGER update_user_card_power_ups_updated_at
    BEFORE UPDATE ON user_card_power_ups
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Drop trigger and function
  pgm.sql("DROP TRIGGER IF EXISTS update_user_card_power_ups_updated_at ON user_card_power_ups;");
  pgm.sql("DROP FUNCTION IF EXISTS update_updated_at_column();");
  
  // Drop table
  pgm.dropTable("user_card_power_ups");
};