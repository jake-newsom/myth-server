/* eslint-disable camelcase */

/**
 * The in-progress reforge on a Forge draft.
 *
 * A player can reroll edge powers before committing the craft, and pays
 * fragments per roll. That roll has to live server-side for the same reason
 * the rest of the draft does — they set it, go grind for the craft cost, and
 * come back expecting the stats they paid to roll — and for one stronger
 * reason: the roll IS the thing they spent fragments on, so losing it on a
 * reinstall would be losing purchased value, not just a convenience.
 *
 * Authoritative, unlike `quoted_price`. The craft path copies these values
 * into `user_card_stat_rolls` verbatim rather than rolling again at
 * redemption, so the card minted is the one the player was shown. That is
 * also why the client never sends a roll: `POST /forge/reforge` generates it
 * server-side and returns the result.
 *
 * `has_roll` distinguishes "not reforged" from "reforged to all zeroes",
 * which is a perfectly reachable outcome (50% per side) and must still count
 * as reforged — it is what the lock UI, the change-tier warning, and the
 * decision to write a stat-roll row at craft time all key off.
 *
 * Locks persist alongside the roll: they are part of the configuration the
 * player is building, and they price the next reroll.
 *
 * All additive with safe defaults, so an old client that never sends these
 * keeps its current behaviour exactly (no roll, nothing locked).
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns("forge_drafts", {
    // Signed offsets, -2..+3 per edge; meaningful only when has_roll is true.
    roll_top: { type: "smallint", notNull: true, default: 0 },
    roll_right: { type: "smallint", notNull: true, default: 0 },
    roll_bottom: { type: "smallint", notNull: true, default: 0 },
    roll_left: { type: "smallint", notNull: true, default: 0 },
    // Whether a reroll has happened at all. See the header note: an all-zero
    // roll is a real result, so the flag cannot be inferred from the values.
    has_roll: { type: "boolean", notNull: true, default: false },
    // Which edges the player is holding through the next reroll.
    lock_top: { type: "boolean", notNull: true, default: false },
    lock_right: { type: "boolean", notNull: true, default: false },
    lock_bottom: { type: "boolean", notNull: true, default: false },
    lock_left: { type: "boolean", notNull: true, default: false },
  });

  pgm.addConstraint("forge_drafts", "forge_draft_roll_range_valid", {
    check: `
      roll_top BETWEEN -2 AND 3 AND
      roll_right BETWEEN -2 AND 3 AND
      roll_bottom BETWEEN -2 AND 3 AND
      roll_left BETWEEN -2 AND 3
    `,
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint("forge_drafts", "forge_draft_roll_range_valid");
  pgm.dropColumns("forge_drafts", [
    "roll_top",
    "roll_right",
    "roll_bottom",
    "roll_left",
    "has_roll",
    "lock_top",
    "lock_right",
    "lock_bottom",
    "lock_left",
  ]);
};
