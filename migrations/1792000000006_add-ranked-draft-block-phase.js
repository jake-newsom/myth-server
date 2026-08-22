/* eslint-disable camelcase */

/**
 * Block phase: after drafting, each player removes one card from their
 * OPPONENT's deck.
 *
 * Draft size goes 10 -> 11 picks per player, and the block takes one back, so
 * both players still start the game with exactly 10 cards. The block choice is
 * kept hidden until BOTH are in — same secrecy rule the ban phase already uses —
 * so neither player can react to the other's choice.
 *
 * Stored as the blocked card's variant id, chosen FROM the opponent's picks:
 *   player1_block = the card player1 removed from player2's deck
 *   player2_block = the card player2 removed from player1's deck
 *
 * Release-safety: both columns are nullable with no default, so existing rows
 * and any in-flight session read fine. The phase CHECK is widened rather than
 * replaced — every previously valid value stays valid, so an older server can
 * still write 'ban'/'draft'/'complete'/'aborted' against this schema.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn("ranked_draft_sessions", {
    player1_block: { type: "uuid", notNull: false },
    player2_block: { type: "uuid", notNull: false },
  });

  // Widen the phase constraint to admit 'block' between draft and complete.
  pgm.dropConstraint("ranked_draft_sessions", "ranked_draft_sessions_phase_check");
  pgm.addConstraint(
    "ranked_draft_sessions",
    "ranked_draft_sessions_phase_check",
    "CHECK (phase IN ('ban', 'draft', 'block', 'complete', 'aborted'))"
  );
};

exports.down = (pgm) => {
  // Any session parked in the new phase would violate the narrower constraint;
  // settle them as aborted rather than failing the rollback.
  pgm.sql("UPDATE ranked_draft_sessions SET phase = 'aborted' WHERE phase = 'block'");

  pgm.dropConstraint("ranked_draft_sessions", "ranked_draft_sessions_phase_check");
  pgm.addConstraint(
    "ranked_draft_sessions",
    "ranked_draft_sessions_phase_check",
    "CHECK (phase IN ('ban', 'draft', 'complete', 'aborted'))"
  );

  pgm.dropColumn("ranked_draft_sessions", ["player1_block", "player2_block"]);
};
