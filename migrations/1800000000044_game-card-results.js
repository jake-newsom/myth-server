/* eslint-disable camelcase */

/**
 * Per-card game outcomes for the balance report (TRACKING.md, "Per-card game
 * results"). Prod blanks game_state 48h after a game ends, so without this we
 * can't tell which cards real players won or lost with.
 *
 * One row per card in a player's deck per finished game, every mode.
 * Additive only: a new table, no API change. Not FK'd to games so the data
 * retention job can never cascade it away; ids are text because ranked draft
 * cards use synthetic instance ids.
 */

exports.up = (pgm) => {
  pgm.createTable("game_card_results", {
    id: { type: "bigserial", primaryKey: true },
    game_id: { type: "uuid", notNull: true },
    user_id: { type: "uuid", notNull: true },
    game_mode: { type: "text", notNull: true },
    card_instance_id: { type: "text", notNull: true },
    character_id: { type: "text" },
    variant_id: { type: "text" },
    was_played: { type: "boolean", notNull: true, default: false },
    result: { type: "text", notNull: true },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });
  pgm.addConstraint("game_card_results", "game_card_results_result_check", {
    check: "result IN ('win','loss','draw')",
  });
  // Idempotency: a retried completion must not double-count.
  pgm.createIndex("game_card_results", ["game_id", "user_id", "card_instance_id"], {
    unique: true,
    name: "game_card_results_game_user_card_uidx",
  });
  pgm.createIndex("game_card_results", ["created_at"]);
  pgm.createIndex("game_card_results", ["character_id", "created_at"]);
};

exports.down = (pgm) => {
  pgm.dropTable("game_card_results");
};
