/* eslint-disable camelcase */

/**
 * Draft sessions for Ranked Draft PvP.
 *
 * A ranked match begins with a ban phase and a 10-pick draft BEFORE any game
 * exists. That pre-game state needs a home, and this is deliberately its own
 * table rather than an early `games` row in a new `drafting` status:
 *
 *   Every existing query that reads `games` assumes a row is a playable match
 *   (reconnect, the active-game guards in matchmaking, the socket auth
 *   middleware, sweepers). Introducing rows in a status none of that code was
 *   written for is exactly the "old code meets new data" hazard we avoid on a
 *   live app. A separate table is inert: nothing existing reads it.
 *
 * The `games` row is created only when the draft completes, at which point
 * `game_id` is backfilled here so a reconnecting client can be routed onward.
 *
 * State that must survive a restart lives in columns (picks, bans, deadline);
 * only the countdown timer itself is in-process, and it is rebuilt from
 * `deadline_at` by the sweeper.
 *
 * Release-safety: a brand-new table, written by nothing until the
 * `ranked-draft-pvp` flag is enabled. Shipping it changes no behaviour.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable("ranked_draft_sessions", {
    session_id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("uuid_generate_v4()"),
    },
    player1_id: {
      type: "uuid",
      notNull: true,
      references: "users(user_id)",
      onDelete: "CASCADE",
    },
    player2_id: {
      type: "uuid",
      notNull: true,
      references: "users(user_id)",
      onDelete: "CASCADE",
    },
    // 'ban' -> 'draft' -> 'complete' | 'aborted'
    phase: {
      type: "varchar(20)",
      notNull: true,
      default: "ban",
    },
    // Each player's single banned card_variant_id. Held server-side and NOT
    // emitted to the opponent until both are non-null — that is what makes the
    // simultaneous ban genuinely hidden rather than hidden client-side.
    player1_ban: { type: "uuid", notNull: false },
    player2_ban: { type: "uuid", notNull: false },
    // Ordered arrays of drafted card_variant_ids, up to DRAFT_PICKS each.
    player1_picks: { type: "jsonb", notNull: true, default: "[]" },
    player2_picks: { type: "jsonb", notNull: true, default: "[]" },
    current_picker_id: { type: "uuid", notNull: false },
    // 0-based index into the snake pick order; also the resume point.
    pick_index: { type: "integer", notNull: true, default: 0 },
    // When the current phase/turn expires. Persisted so a restart can recover
    // the clock instead of stranding a draft forever.
    deadline_at: { type: "timestamptz", notNull: false },
    // Backfilled at completion.
    game_id: {
      type: "uuid",
      notNull: false,
      references: "games(game_id)",
      onDelete: "SET NULL",
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  pgm.addConstraint("ranked_draft_sessions", "ranked_draft_sessions_phase_check", {
    check: "phase IN ('ban', 'draft', 'complete', 'aborted')",
  });

  // Reconnect path: "does this user have a live draft?"
  pgm.createIndex("ranked_draft_sessions", "player1_id", {
    name: "ranked_draft_sessions_p1_live_idx",
    where: "phase IN ('ban', 'draft')",
  });
  pgm.createIndex("ranked_draft_sessions", "player2_id", {
    name: "ranked_draft_sessions_p2_live_idx",
    where: "phase IN ('ban', 'draft')",
  });
  // Sweeper path: "which live drafts have blown their deadline?"
  pgm.createIndex("ranked_draft_sessions", "deadline_at", {
    name: "ranked_draft_sessions_deadline_idx",
    where: "phase IN ('ban', 'draft')",
  });
};

exports.down = (pgm) => {
  pgm.dropTable("ranked_draft_sessions");
};
