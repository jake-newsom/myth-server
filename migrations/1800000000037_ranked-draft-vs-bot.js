/* eslint-disable camelcase */

/**
 * Ranked Draft practice bot.
 *
 * vs_bot: the session's player2 is the AI (AI_PLAYER_ID), started from the
 * queue's "Play bot match" offer. Its game is a `solo` row, so this flag (via
 * ranked_draft_sessions.game_id) is how completion recognises a bot match.
 *
 * bot_rating_delta: the flat rating actually granted for that game (0 when the
 * daily cap was reached or the game was lost). NULL until the game completes;
 * written once, which is what keeps the grant exactly-once.
 *
 * Additive only: both columns default so every existing row and query is
 * unchanged, and old code never reads them.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE ranked_draft_sessions
      ADD COLUMN IF NOT EXISTS vs_bot boolean NOT NULL DEFAULT false;
    ALTER TABLE ranked_draft_sessions
      ADD COLUMN IF NOT EXISTS bot_rating_delta integer;
    CREATE INDEX IF NOT EXISTS ranked_draft_sessions_bot_game_idx
      ON ranked_draft_sessions (game_id) WHERE vs_bot;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS ranked_draft_sessions_bot_game_idx;
    ALTER TABLE ranked_draft_sessions DROP COLUMN IF EXISTS bot_rating_delta;
    ALTER TABLE ranked_draft_sessions DROP COLUMN IF EXISTS vs_bot;
  `);
};
