/**
 * Migration: Add monthly login rewards system
 * 
 * Creates tables for monthly login reward configuration and user progress tracking.
 * - monthly_login_config: Defines rewards for each day (1-24) of the month
 * - user_monthly_login_progress: Tracks each user's monthly login progress
 * 
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  // Create enum for reward types
  pgm.createType('monthly_reward_type', [
    'gems',
    'fate_coins',
    'card_fragments',
    'card_pack',
    'enhanced_card'
  ]);

  // Create monthly login config table
  pgm.createTable('monthly_login_config', {
    config_id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    day: {
      type: 'integer',
      notNull: true,
      comment: 'Day of the month (1-24)',
    },
    reward_type: {
      type: 'monthly_reward_type',
      notNull: true,
    },
    amount: {
      type: 'integer',
      notNull: true,
      default: 0,
      comment: 'Amount of reward (for gems, fragments, coins, packs). Ignored for enhanced_card.',
    },
    card_id: {
      type: 'uuid',
      references: 'cards(card_id)',
      onDelete: 'SET NULL',
      comment: 'Specific card_id for enhanced_card rewards (null for random selection)',
    },
    is_active: {
      type: 'boolean',
      notNull: true,
      default: true,
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

  // Create unique constraint on day
  pgm.addConstraint('monthly_login_config', 'unique_day', {
    unique: ['day']
  });

  // Create check constraint for day range
  pgm.addConstraint('monthly_login_config', 'day_range', {
    check: 'day >= 1 AND day <= 24'
  });

  // Create check constraint for amount (must be positive for non-enhanced_card types)
  pgm.addConstraint('monthly_login_config', 'amount_positive', {
    check: '(reward_type = \'enhanced_card\' AND amount >= 0) OR (reward_type != \'enhanced_card\' AND amount > 0)'
  });

  // Create user monthly login progress table
  pgm.createTable('user_monthly_login_progress', {
    progress_id: {
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
    month_year: {
      type: 'varchar(7)',
      notNull: true,
      comment: 'Format: YYYY-MM (e.g., 2024-01)',
    },
    current_day: {
      type: 'integer',
      notNull: true,
      default: 0,
      comment: 'Current highest day reached (0-24)',
    },
    claimed_days: {
      type: 'integer[]',
      notNull: true,
      default: '{}',
      comment: 'Array of day numbers that have been claimed',
    },
    last_claim_date: {
      type: 'date',
      comment: 'Date (UTC) of the last reward claim - used to enforce one claim per calendar day',
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

  // Create unique constraint on user_id + month_year
  pgm.addConstraint('user_monthly_login_progress', 'unique_user_month', {
    unique: ['user_id', 'month_year']
  });

  // Create indexes for performance
  pgm.createIndex('monthly_login_config', 'day');
  pgm.createIndex('monthly_login_config', 'is_active');
  pgm.createIndex('user_monthly_login_progress', 'user_id');
  pgm.createIndex('user_monthly_login_progress', 'month_year');
  pgm.createIndex('user_monthly_login_progress', ['user_id', 'month_year']);

  console.log('Created monthly login rewards tables');
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Drop tables in reverse order
  pgm.dropTable('user_monthly_login_progress');
  pgm.dropTable('monthly_login_config');
  
  // Drop enum
  pgm.dropType('monthly_reward_type');
  
  console.log('Dropped monthly login rewards tables');
};

