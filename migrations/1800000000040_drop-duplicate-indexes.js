/* eslint-disable camelcase */

/*
 * Drops indexes that duplicate another index on the same columns: plain
 * pairs created twice under different names (baseline `*_index` vs
 * 1765500000000's `idx_*`), and plain indexes shadowed by a unique index on
 * the same columns. Each one costs a write on every insert/update of hot
 * tables (games, users, user_sessions, user_owned_cards, deck_cards).
 *
 * Deploy safety (render:start runs migrations before the server starts):
 * - DROP INDEX CONCURRENTLY, outside a transaction: no lock that blocks
 *   reads/writes on the table.
 * - Each drop is guarded: it only happens if `keep` exists, is valid, and
 *   covers the exact same columns/opclasses/collations with no predicate or
 *   expressions (and is unique if the dropped one is). A database whose
 *   history named things differently keeps its only index.
 */

exports.shorthands = undefined;

// [table, index to drop, index that must remain, definition for down()]
const DUPLICATES = [
  ["achievements", "idx_achievements_achievement_key", "achievements_achievement_key_key",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_achievements_achievement_key ON achievements USING btree (achievement_key)"],
  ["daily_task_selections", "daily_task_selections_selection_date_index", "daily_task_selections_pkey",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS daily_task_selections_selection_date_index ON daily_task_selections USING btree (selection_date)"],
  ["deck_cards", "idx_deck_cards_deck_id", "deck_cards_deck_id_index",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deck_cards_deck_id ON deck_cards USING btree (deck_id)"],
  ["deck_cards", "idx_deck_cards_instance_id", "deck_cards_user_card_instance_id_index",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deck_cards_instance_id ON deck_cards USING btree (user_card_instance_id)"],
  ["decks", "idx_decks_user_id", "decks_user_id_index",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_decks_user_id ON decks USING btree (user_id)"],
  ["event_milestones", "event_milestones_event", "event_milestones_event_id_threshold_key",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS event_milestones_event ON event_milestones USING btree (event_id, threshold)"],
  ["fate_pick_participations", "wonder_pick_participations_unique_per_pick", "fate_pick_participations_unique_per_pick",
    "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS wonder_pick_participations_unique_per_pick ON fate_pick_participations USING btree (fate_pick_id, participant_id)"],
  ["games", "idx_games_game_status", "games_game_status_index",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_games_game_status ON games USING btree (game_status)"],
  ["games", "idx_games_player1_id", "games_player1_id_index",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_games_player1_id ON games USING btree (player1_id)"],
  ["games", "idx_games_player2_id", "games_player2_id_index",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_games_player2_id ON games USING btree (player2_id)"],
  ["login_sequence_rewards", "login_sequence_rewards_seq", "login_sequence_rewards_sequence_id_day_index_key",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS login_sequence_rewards_seq ON login_sequence_rewards USING btree (sequence_id, day_index)"],
  ["monthly_login_config", "monthly_login_config_day_index", "unique_day",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS monthly_login_config_day_index ON monthly_login_config USING btree (day)"],
  ["sets", "sets_name_index", "sets_name_key",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS sets_name_index ON sets USING btree (name)"],
  ["special_abilities", "special_abilities_id_index", "special_abilities_id_key",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS special_abilities_id_index ON special_abilities USING btree (id)"],
  ["user_achievements", "idx_user_achievements_user_achievement", "user_achievements_user_achievement_unique",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_achievements_user_achievement ON user_achievements USING btree (user_id, achievement_id)"],
  ["user_card_power_ups", "idx_user_card_power_ups_instance_id", "user_card_power_ups_user_card_instance_id_key",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_card_power_ups_instance_id ON user_card_power_ups USING btree (user_card_instance_id)"],
  ["user_card_xp_pools", "user_card_xp_pools_user_id_card_name_index", "pk_user_card_xp_pools",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS user_card_xp_pools_user_id_card_name_index ON user_card_xp_pools USING btree (user_id, card_name)"],
  ["user_monthly_login_progress", "user_monthly_login_progress_user_id_month_year_index", "unique_user_month",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS user_monthly_login_progress_user_id_month_year_index ON user_monthly_login_progress USING btree (user_id, month_year)"],
  ["user_owned_cards", "idx_user_owned_cards_card_id", "user_owned_cards_card_variant_id_index",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_owned_cards_card_id ON user_owned_cards USING btree (card_variant_id)"],
  ["user_owned_cards", "idx_user_owned_cards_user_id", "user_owned_cards_user_id_index",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_owned_cards_user_id ON user_owned_cards USING btree (user_id)"],
  ["user_rankings", "idx_user_rankings_user_season", "user_rankings_user_season_unique",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_rankings_user_season ON user_rankings USING btree (user_id, season)"],
  ["user_sessions", "user_sessions_access_token_hash_idx", "user_sessions_access_token_hash_key",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS user_sessions_access_token_hash_idx ON user_sessions USING btree (access_token_hash)"],
  ["user_sessions", "user_sessions_refresh_token_hash_idx", "user_sessions_refresh_token_hash_key",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS user_sessions_refresh_token_hash_idx ON user_sessions USING btree (refresh_token_hash)"],
  ["users", "users_apple_id_index", "users_apple_id_key",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS users_apple_id_index ON users USING btree (apple_id)"],
  ["users", "users_email_index", "users_email_key",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS users_email_index ON users USING btree (email)"],
  ["users", "users_facebook_id_index", "users_facebook_id_key",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS users_facebook_id_index ON users USING btree (facebook_id)"],
  ["users", "users_google_id_index", "users_google_id_key",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS users_google_id_index ON users USING btree (google_id)"],
  ["users", "users_username_index", "users_username_key",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS users_username_index ON users USING btree (username)"],
];

// True when `keep` is a valid, plain index on the same table and columns
// (same opclasses/collations) as `drop`, and unique if `drop` is unique.
const COVERED_SQL = `
  SELECT 1
  FROM pg_index d
  JOIN pg_class di ON di.oid = d.indexrelid
  JOIN pg_class t ON t.oid = d.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  JOIN pg_index k ON k.indrelid = d.indrelid
  JOIN pg_class ki ON ki.oid = k.indexrelid
  WHERE n.nspname = current_schema()
    AND t.relname = $1 AND di.relname = $2 AND ki.relname = $3
    AND k.indisvalid
    AND k.indkey::text = d.indkey::text
    AND k.indclass::text = d.indclass::text
    AND k.indcollation::text = d.indcollation::text
    AND k.indpred IS NULL AND k.indexprs IS NULL
    AND d.indpred IS NULL AND d.indexprs IS NULL
    AND (k.indisunique OR NOT d.indisunique)
`;

exports.up = async (pgm) => {
  pgm.noTransaction();
  for (const [table, drop, keep] of DUPLICATES) {
    const { rows } = await pgm.db.query(COVERED_SQL, [table, drop, keep]);
    if (rows.length === 0) {
      console.log(`- kept ${drop} (no equivalent ${keep} found)`);
      continue;
    }
    pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS "${drop}"`);
    console.log(`✓ dropping ${drop} (covered by ${keep})`);
  }
};

exports.down = (pgm) => {
  pgm.noTransaction();
  for (const [, , , create] of DUPLICATES) pgm.sql(create);
};
