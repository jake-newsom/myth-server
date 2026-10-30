/* eslint-disable camelcase */

/**
 * Optimistic lock for game writes: every updateGameAfterAction bumps
 * state_version, and the HTTP action handlers only write if it still matches
 * the row they read.
 *
 * Additive only: a constant default needs no table rewrite or backfill.
 */

exports.up = (pgm) => {
  pgm.addColumn("games", {
    state_version: { type: "integer", notNull: true, default: 0 },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("games", "state_version");
};
