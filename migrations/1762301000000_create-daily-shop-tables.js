/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  // Create enum for shop item types
  pgm.createType('shop_item_type', [
    'legendary_card',
    'epic_card', 
    'enhanced_card',
    'pack'
  ]);

  // Create enum for currency types
  pgm.createType('currency_type', [
    'gold',
    'gems',
    'card_fragments',
    'fate_coins'
  ]);

  // Create daily shop configuration table
  pgm.createTable('daily_shop_config', {
    config_id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    item_type: {
      type: 'shop_item_type',
      notNull: true,
    },
    daily_limit: {
      type: 'integer',
      notNull: true,
      default: 1,
    },
    price: {
      type: 'integer',
      notNull: true,
    },
    currency: {
      type: 'currency_type',
      notNull: true,
    },
    daily_availability: {
      type: 'integer',
      notNull: true,
      default: 1,
    },
    is_active: {
      type: 'boolean',
      notNull: true,
      default: true,
    },
    reset_price_gems: {
      type: 'integer',
      default: 50,
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
    updated_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  // Create unique constraint on item_type for configuration
  pgm.addConstraint('daily_shop_config', 'unique_item_type', {
    unique: ['item_type']
  });

  // Create daily shop offerings table
  pgm.createTable('daily_shop_offerings', {
    offering_id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    shop_date: {
      type: 'date',
      notNull: true,
    },
    item_type: {
      type: 'shop_item_type',
      notNull: true,
    },
    card_id: {
      type: 'uuid',
      references: 'cards(card_id)',
      onDelete: 'CASCADE',
    },
    mythology: {
      type: 'varchar(50)',
    },
    price: {
      type: 'integer',
      notNull: true,
    },
    currency: {
      type: 'currency_type',
      notNull: true,
    },
    slot_number: {
      type: 'integer',
      notNull: true,
      default: 1,
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  // Create indexes for daily shop offerings
  pgm.createIndex('daily_shop_offerings', ['shop_date']);
  pgm.createIndex('daily_shop_offerings', ['shop_date', 'item_type']);
  pgm.createIndex('daily_shop_offerings', ['mythology']);

  // Create daily shop purchases table
  pgm.createTable('daily_shop_purchases', {
    purchase_id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users(user_id)',
      onDelete: 'CASCADE',
    },
    offering_id: {
      type: 'uuid',
      notNull: true,
      references: 'daily_shop_offerings(offering_id)',
      onDelete: 'CASCADE',
    },
    shop_date: {
      type: 'date',
      notNull: true,
    },
    item_type: {
      type: 'shop_item_type',
      notNull: true,
    },
    quantity_purchased: {
      type: 'integer',
      notNull: true,
      default: 1,
    },
    total_cost: {
      type: 'integer',
      notNull: true,
    },
    currency_used: {
      type: 'currency_type',
      notNull: true,
    },
    resets_used: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    purchased_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  // Create indexes for daily shop purchases
  pgm.createIndex('daily_shop_purchases', ['user_id', 'shop_date']);
  pgm.createIndex('daily_shop_purchases', ['shop_date']);
  pgm.createIndex('daily_shop_purchases', ['user_id', 'shop_date', 'item_type']);

  // Create daily shop rotations table for mythology tracking
  pgm.createTable('daily_shop_rotations', {
    rotation_id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    mythology: {
      type: 'varchar(50)',
      notNull: true,
    },
    item_type: {
      type: 'shop_item_type',
      notNull: true,
    },
    current_card_index: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    last_updated: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  // Create unique constraint for mythology + item_type combination
  pgm.addConstraint('daily_shop_rotations', 'unique_mythology_item_type', {
    unique: ['mythology', 'item_type']
  });

  // Add constraints
  pgm.addConstraint('daily_shop_config', 'daily_limit_positive', {
    check: 'daily_limit > 0'
  });
  
  pgm.addConstraint('daily_shop_config', 'price_positive', {
    check: 'price > 0'
  });

  pgm.addConstraint('daily_shop_config', 'daily_availability_positive', {
    check: 'daily_availability > 0'
  });

  pgm.addConstraint('daily_shop_purchases', 'quantity_positive', {
    check: 'quantity_purchased > 0'
  });

  pgm.addConstraint('daily_shop_purchases', 'total_cost_positive', {
    check: 'total_cost > 0'
  });

  pgm.addConstraint('daily_shop_purchases', 'resets_non_negative', {
    check: 'resets_used >= 0'
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Drop tables in reverse order
  pgm.dropTable('daily_shop_rotations');
  pgm.dropTable('daily_shop_purchases');
  pgm.dropTable('daily_shop_offerings');
  pgm.dropTable('daily_shop_config');
  
  // Drop enums
  pgm.dropType('currency_type');
  pgm.dropType('shop_item_type');
};
