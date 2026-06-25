/**
 * Partial indexes on `games` for the active-game lookups.
 *
 * The hot read paths (getActiveGamesForUser / getActiveGamesSummary in
 * game.service, plus the matchmaking active/stale-game checks) all filter on
 *
 *     (player1_id = $1 OR player2_id = $1) AND game_status = 'active'
 *
 * Those queries were rewritten to UNION the two player branches so each branch
 * can use a per-player index. The full-table single-column indexes on
 * player1_id / player2_id still scan every game a user has ever played; active
 * games are a tiny fraction of the table. These partial indexes cover only
 * non-tutorial active rows, so each branch becomes a small index scan.
 *
 * Predicate matches the query filters (game_status='active' AND
 * is_tutorial=false). The matchmaking PvP check additionally filters
 * game_mode='pvp', which is applied as a cheap post-filter on the already-tiny
 * active set.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

const ACTIVE_PREDICATE = "game_status = 'active' AND is_tutorial = false";

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.createIndex("games", "player1_id", {
    name: "games_player1_active_idx",
    where: ACTIVE_PREDICATE,
  });
  pgm.createIndex("games", "player2_id", {
    name: "games_player2_active_idx",
    where: ACTIVE_PREDICATE,
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropIndex("games", "player1_id", { name: "games_player1_active_idx" });
  pgm.dropIndex("games", "player2_id", { name: "games_player2_active_idx" });
};
