/* eslint-disable camelcase */

/**
 * Outcome-based event currency drops, with a first-win bonus and a daily cap.
 *
 * ## What was there before
 *
 * A single `currency_drop_chance` plus a `[min, max]` range: every finished
 * game rolled the same lottery regardless of whether it was won, lost or
 * abandoned, and nothing bounded a day's total. That makes the earn rate
 * unpredictable for the player and unbounded for us — the exact two properties
 * a milestone track has to be designed against.
 *
 * ## What replaces it
 *
 * Fixed amounts per outcome, so a player always knows what a match is worth:
 *
 *   currency_win_amount        a win
 *   currency_draw_amount       a draw
 *   currency_loss_amount       a completed loss
 *   currency_forfeit_amount    a surrender or disconnect (0 — a forfeit should
 *                              never be the efficient way to farm)
 *   currency_first_win_bonus   added to the first win of each UTC day
 *   currency_daily_cap         ceiling on ordinary match drops per day; the
 *                              first-win bonus is paid ON TOP, so the real
 *                              daily maximum is cap + bonus
 *
 * A cap of 0 means uncapped, which is what every currently-configured event
 * wants — see the defaults below.
 *
 * ## Backward compatibility
 *
 * The old chance/min/max columns are LEFT IN PLACE and still read by
 * EventCurrencyDropService when `currency_win_amount` is 0, so an event
 * configured the old way keeps behaving exactly as it does today. The defaults
 * here are all zero, so this migration alone changes no event's behaviour;
 * Hallow's Eve opts in explicitly in the next migration.
 *
 * That also makes the whole rules change revertible by data: zero out the new
 * columns and the old lottery resumes.
 */

exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.addColumns("events", {
    currency_win_amount: {
      type: "integer",
      notNull: true,
      default: 0,
      comment:
        "Currency for a win. When 0, the event falls back to the legacy chance/min/max lottery.",
    },
    currency_draw_amount: { type: "integer", notNull: true, default: 0 },
    currency_loss_amount: { type: "integer", notNull: true, default: 0 },
    currency_forfeit_amount: { type: "integer", notNull: true, default: 0 },
    currency_first_win_bonus: {
      type: "integer",
      notNull: true,
      default: 0,
      comment: "Added to the first win of each UTC day. Paid on top of the daily cap.",
    },
    currency_daily_cap: {
      type: "integer",
      notNull: true,
      default: 0,
      comment:
        "Ceiling on ordinary match drops per UTC day. 0 means uncapped. Excludes the first-win bonus.",
    },
  });

  pgm.addConstraint("events", "events_currency_amounts_check", {
    check: `currency_win_amount >= 0
        AND currency_draw_amount >= 0
        AND currency_loss_amount >= 0
        AND currency_forfeit_amount >= 0
        AND currency_first_win_bonus >= 0
        AND currency_daily_cap >= 0`,
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropConstraint("events", "events_currency_amounts_check");
  pgm.dropColumns("events", [
    "currency_win_amount",
    "currency_draw_amount",
    "currency_loss_amount",
    "currency_forfeit_amount",
    "currency_first_win_bonus",
    "currency_daily_cap",
  ]);
};
