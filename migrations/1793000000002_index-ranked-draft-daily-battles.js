/* eslint-disable camelcase */

/**
 * Indexes the query behind the Ranked Draft daily battle cap.
 *
 * The cap itself is NOT separately flag-gated: the whole mode is behind
 * `ranked-draft-pvp` and has never shipped, so the limit goes out as part of
 * the mode rather than as a switch over existing behaviour.
 *
 * The index covers "ranked_draft games this user played today". `games` already
 * indexes player1_id, player2_id and created_at separately, but none of those
 * alone is selective for this query as the table grows; two partial indexes
 * (one per player column, restricted to the ranked_draft mode) let Postgres
 * answer each side of the OR from an index.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_games_ranked_draft_p1_created
      ON "games" (player1_id, created_at)
      WHERE game_mode = 'ranked_draft';
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_games_ranked_draft_p2_created
      ON "games" (player2_id, created_at)
      WHERE game_mode = 'ranked_draft';
  `);

  // Drops the flag seeded by an earlier revision of this migration, so a
  // database that already ran it does not keep a row nothing reads.
  pgm.sql(`DELETE FROM feature_flags WHERE key = 'ranked-draft-daily-limit';`);
};

exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS idx_games_ranked_draft_p1_created;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_games_ranked_draft_p2_created;`);
};
