/* eslint-disable camelcase */

/**
 * Weekly Riddle: one "win in 2" puzzle per week (Wednesday 00:00 UTC).
 *
 *   riddle_puzzles   pool of harvested candidates; picked, re-solved and recycled
 *   riddle_weeks     one row per week, with the state and answer table frozen at go-live
 *   riddle_attempts  every play-through (first move → server reply → final move)
 *   riddle_progress  per user per week; the leaderboard source
 *
 * Plus three titles granted by RiddleService on clear.
 *
 * Additive only: new tables and title rows.
 */

exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE riddle_puzzles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'approved', 'retired')),
      source_seed bigint,
      state jsonb NOT NULL,
      card_ids text[] NOT NULL DEFAULT '{}',
      notes text,
      last_used_at timestamptz,
      times_used integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX riddle_puzzles_pick_idx ON riddle_puzzles (status, last_used_at NULLS FIRST, times_used);

    CREATE TABLE riddle_weeks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      week_number integer NOT NULL UNIQUE,
      puzzle_id uuid NOT NULL REFERENCES riddle_puzzles(id),
      release_at timestamptz NOT NULL,
      ends_at timestamptz NOT NULL,
      seed bigint NOT NULL,
      state jsonb NOT NULL,
      answer_table jsonb NOT NULL,
      solution jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX riddle_weeks_release_idx ON riddle_weeks (release_at);

    CREATE TABLE riddle_attempts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      week_id uuid NOT NULL REFERENCES riddle_weeks(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      attempt_no integer NOT NULL,
      first_move jsonb NOT NULL,
      server_reply jsonb,
      final_move jsonb,
      cleared boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      finished_at timestamptz
    );
    CREATE INDEX riddle_attempts_user_week_idx ON riddle_attempts (week_id, user_id, created_at DESC);
    CREATE INDEX riddle_attempts_created_idx ON riddle_attempts (created_at);

    CREATE TABLE riddle_progress (
      week_id uuid NOT NULL REFERENCES riddle_weeks(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      attempts integer NOT NULL DEFAULT 0,
      attempts_to_clear integer,
      clear_rank integer,
      first_cleared_at timestamptz,
      PRIMARY KEY (week_id, user_id)
    );
    CREATE INDEX riddle_progress_board_idx ON riddle_progress (week_id, attempts_to_clear, first_cleared_at)
      WHERE attempts_to_clear IS NOT NULL;

    INSERT INTO titles (code_key, name, description, accent) VALUES
      ('oracles_chosen', 'Oracle''s Chosen', 'First to solve a Weekly Riddle.', 'gold'),
      ('first_seer', 'First Seer', 'One of the first 5 to solve a Weekly Riddle.', 'purple'),
      ('clear_sight', 'Clear Sight', 'Solved a Weekly Riddle on the first try.', 'blue')
    ON CONFLICT (code_key) DO NOTHING;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS riddle_progress;
    DROP TABLE IF EXISTS riddle_attempts;
    DROP TABLE IF EXISTS riddle_weeks;
    DROP TABLE IF EXISTS riddle_puzzles;
    DELETE FROM user_owned_titles WHERE title_id IN
      (SELECT title_id FROM titles WHERE code_key IN ('oracles_chosen', 'first_seer', 'clear_sight'));
    DELETE FROM titles WHERE code_key IN ('oracles_chosen', 'first_seer', 'clear_sight');
  `);
};
