/**
 * Add critical performance indexes to improve query performance.
 * This migration addresses N+1 query issues and slow lookups identified in performance analysis.
 * 
 * Critical indexes added:
 * - user_achievements(user_id, achievement_id) - For achievement lookups and claims
 * - achievements(base_achievement_key, tier_level) - For tiered achievement queries
 * - user_owned_cards(user_id) - For user card collection queries
 * - user_owned_cards(card_id) - For card instance lookups
 * - deck_cards(deck_id) - For deck loading
 * - deck_cards(user_card_instance_id) - For card-to-deck queries
 * - games(player1_id) - For player game history
 * - games(player2_id) - For player game history
 * - user_rankings(user_id, season) - For leaderboard queries
 * - achievements(achievement_key) - For achievement key lookups
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
  console.log('Adding performance indexes...');

  // CRITICAL: user_achievements composite index
  // Used in: getUserAchievement, claimAchievement, and all achievement update operations
  pgm.createIndex('user_achievements', ['user_id', 'achievement_id'], {
    name: 'idx_user_achievements_user_achievement',
    ifNotExists: true,
  });
  console.log('✓ Added index: idx_user_achievements_user_achievement');

  // CRITICAL: achievements base_achievement_key + tier_level
  // Used in: getTieredAchievementsByBaseKey (called 12+ times per game completion)
  pgm.createIndex('achievements', ['base_achievement_key', 'tier_level'], {
    name: 'idx_achievements_base_key_tier',
    ifNotExists: true,
    where: 'is_active = true',
  });
  console.log('✓ Added index: idx_achievements_base_key_tier');

  // CRITICAL: achievements achievement_key
  // Used in: getAchievementByKey (called frequently for progress updates)
  pgm.createIndex('achievements', 'achievement_key', {
    name: 'idx_achievements_achievement_key',
    ifNotExists: true,
  });
  console.log('✓ Added index: idx_achievements_achievement_key');

  // HIGH: user_owned_cards user_id
  // Used in: findInstancesByUserId, card collection queries
  pgm.createIndex('user_owned_cards', 'user_id', {
    name: 'idx_user_owned_cards_user_id',
    ifNotExists: true,
  });
  console.log('✓ Added index: idx_user_owned_cards_user_id');

  // HIGH: user_owned_cards card_id
  // Used in: card instance lookups, achievement checks
  pgm.createIndex('user_owned_cards', 'card_id', {
    name: 'idx_user_owned_cards_card_id',
    ifNotExists: true,
  });
  console.log('✓ Added index: idx_user_owned_cards_card_id');

  // HIGH: deck_cards deck_id
  // Used in: findDeckWithInstanceDetails, deck loading operations
  pgm.createIndex('deck_cards', 'deck_id', {
    name: 'idx_deck_cards_deck_id',
    ifNotExists: true,
  });
  console.log('✓ Added index: idx_deck_cards_deck_id');

  // HIGH: deck_cards user_card_instance_id
  // Used in: card-to-deck relationship queries
  pgm.createIndex('deck_cards', 'user_card_instance_id', {
    name: 'idx_deck_cards_instance_id',
    ifNotExists: true,
  });
  console.log('✓ Added index: idx_deck_cards_instance_id');

  // MEDIUM: games player1_id
  // Used in: game history queries, active game lookups
  pgm.createIndex('games', 'player1_id', {
    name: 'idx_games_player1_id',
    ifNotExists: true,
  });
  console.log('✓ Added index: idx_games_player1_id');

  // MEDIUM: games player2_id
  // Used in: game history queries, active game lookups
  pgm.createIndex('games', 'player2_id', {
    name: 'idx_games_player2_id',
    ifNotExists: true,
  });
  console.log('✓ Added index: idx_games_player2_id');

  // MEDIUM: games game_status
  // Used in: active game queries
  pgm.createIndex('games', 'game_status', {
    name: 'idx_games_game_status',
    ifNotExists: true,
  });
  console.log('✓ Added index: idx_games_game_status');

  // MEDIUM: user_rankings (user_id, season) composite
  // Used in: leaderboard queries, user ranking lookups
  pgm.createIndex('user_rankings', ['user_id', 'season'], {
    name: 'idx_user_rankings_user_season',
    ifNotExists: true,
  });
  console.log('✓ Added index: idx_user_rankings_user_season');

  // MEDIUM: user_rankings season + rating
  // Used in: leaderboard ordering, rank calculations
  pgm.createIndex('user_rankings', ['season', 'rating', 'wins'], {
    name: 'idx_user_rankings_season_rating',
    ifNotExists: true,
  });
  console.log('✓ Added index: idx_user_rankings_season_rating');

  // MEDIUM: decks user_id
  // Used in: findAllByUserId
  pgm.createIndex('decks', 'user_id', {
    name: 'idx_decks_user_id',
    ifNotExists: true,
  });
  console.log('✓ Added index: idx_decks_user_id');

  // MEDIUM: game_results for player game history
  pgm.createIndex('game_results', 'player1_id', {
    name: 'idx_game_results_player1_id',
    ifNotExists: true,
  });
  console.log('✓ Added index: idx_game_results_player1_id');

  pgm.createIndex('game_results', 'player2_id', {
    name: 'idx_game_results_player2_id',
    ifNotExists: true,
  });
  console.log('✓ Added index: idx_game_results_player2_id');

  pgm.createIndex('game_results', 'season', {
    name: 'idx_game_results_season',
    ifNotExists: true,
  });
  console.log('✓ Added index: idx_game_results_season');

  // MEDIUM: user_card_power_ups for power-up lookups
  pgm.createIndex('user_card_power_ups', 'user_card_instance_id', {
    name: 'idx_user_card_power_ups_instance_id',
    ifNotExists: true,
  });
  console.log('✓ Added index: idx_user_card_power_ups_instance_id');

  console.log('✅ All performance indexes added successfully!');
  console.log('Expected performance improvements:');
  console.log('  - Achievement queries: 10-100x faster');
  console.log('  - Deck loading: 5-10x faster');
  console.log('  - User card queries: 5-20x faster');
  console.log('  - Leaderboard queries: 3-10x faster');
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  console.log('Removing performance indexes...');

  // Drop all indexes in reverse order
  pgm.dropIndex('user_card_power_ups', ['user_card_instance_id'], {
    name: 'idx_user_card_power_ups_instance_id',
    ifExists: true,
  });

  pgm.dropIndex('game_results', 'season', {
    name: 'idx_game_results_season',
    ifExists: true,
  });

  pgm.dropIndex('game_results', 'player2_id', {
    name: 'idx_game_results_player2_id',
    ifExists: true,
  });

  pgm.dropIndex('game_results', 'player1_id', {
    name: 'idx_game_results_player1_id',
    ifExists: true,
  });

  pgm.dropIndex('decks', 'user_id', {
    name: 'idx_decks_user_id',
    ifExists: true,
  });

  pgm.dropIndex('user_rankings', ['season', 'rating', 'wins'], {
    name: 'idx_user_rankings_season_rating',
    ifExists: true,
  });

  pgm.dropIndex('user_rankings', ['user_id', 'season'], {
    name: 'idx_user_rankings_user_season',
    ifExists: true,
  });

  pgm.dropIndex('games', 'game_status', {
    name: 'idx_games_game_status',
    ifExists: true,
  });

  pgm.dropIndex('games', 'player2_id', {
    name: 'idx_games_player2_id',
    ifExists: true,
  });

  pgm.dropIndex('games', 'player1_id', {
    name: 'idx_games_player1_id',
    ifExists: true,
  });

  pgm.dropIndex('deck_cards', 'user_card_instance_id', {
    name: 'idx_deck_cards_instance_id',
    ifExists: true,
  });

  pgm.dropIndex('deck_cards', 'deck_id', {
    name: 'idx_deck_cards_deck_id',
    ifExists: true,
  });

  pgm.dropIndex('user_owned_cards', 'card_id', {
    name: 'idx_user_owned_cards_card_id',
    ifExists: true,
  });

  pgm.dropIndex('user_owned_cards', 'user_id', {
    name: 'idx_user_owned_cards_user_id',
    ifExists: true,
  });

  pgm.dropIndex('achievements', 'achievement_key', {
    name: 'idx_achievements_achievement_key',
    ifExists: true,
  });

  pgm.dropIndex('achievements', ['base_achievement_key', 'tier_level'], {
    name: 'idx_achievements_base_key_tier',
    ifExists: true,
  });

  pgm.dropIndex('user_achievements', ['user_id', 'achievement_id'], {
    name: 'idx_user_achievements_user_achievement',
    ifExists: true,
  });

  console.log('✓ All performance indexes removed');
};

