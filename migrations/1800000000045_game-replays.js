/* eslint-disable camelcase */

/**
 * Compact replay record per finished game, kept 30 days (DataRetentionService
 * deletes older rows). Written at game completion and by the retention job
 * just before it blanks a game's full game_state, so every game gets one.
 *
 * `record` (about 2-4 KB) holds the starting cards (identity, level, stats,
 * enhancements, saga rune), every placement in order, and the final board.
 * Games that finished before move_log existed have `moves: null`.
 *
 * Additive only: a new table, no API change. Not FK'd to games, matching
 * game_card_results.
 */

exports.up = (pgm) => {
  pgm.createTable("game_replays", {
    game_id: { type: "uuid", primaryKey: true },
    game_mode: { type: "text", notNull: true },
    player1_id: { type: "uuid" },
    player2_id: { type: "uuid" },
    winner_id: { type: "uuid" },
    record: { type: "jsonb", notNull: true },
    finished_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });
  pgm.createIndex("game_replays", ["finished_at"]);
};

exports.down = (pgm) => {
  pgm.dropTable("game_replays");
};
