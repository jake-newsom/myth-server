/* eslint-disable camelcase */

/**
 * Per-day drop tracking: `user_event_currency_daily_drops`.
 *
 * The Hallow's Eve drop rules are outcome-based and daily-bounded — a win pays
 * 2, a draw or loss 1, a forfeit nothing; the first win each day pays a further
 * 5; and ordinary match drops stop at 40 a day. None of that is answerable from
 * `user_event_currency_balances`, which knows only a running total.
 *
 * Two counters per (user, currency, day):
 *
 *   match_earned    Candy from ordinary match drops. This is what the 40/day
 *                   cap measures, and it deliberately EXCLUDES the first-win
 *                   bonus so the bonus cannot consume the cap it sits on top
 *                   of — hence 45/day, not 40.
 *   first_win_bonus Whether today's first-win bonus has been paid. An integer
 *                   rather than a boolean so a future event can pay a different
 *                   amount, or several tiers, without a migration.
 *
 * ## Why a day column rather than a rolling window
 *
 * "First win each day" and "40 per day" are calendar claims players reason
 * about against a reset they can predict. `drop_date` is a DATE in UTC, matching
 * how the daily shop already rotates (`getCurrentShopDate`), so both reset
 * together and a player never sees one reset without the other.
 *
 * Rows are never updated after their day passes, so this doubles as the audit
 * trail for how a balance was earned. Cleanup belongs to DataRetentionService
 * once the event is long over; the table is small (one row per active player
 * per day) and there is no urgency.
 *
 * Additive: a new table nothing reads until the drop service ships alongside.
 */

exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.createTable("user_event_currency_daily_drops", {
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(user_id)",
      onDelete: "CASCADE",
    },
    currency_id: {
      type: "uuid",
      notNull: true,
      references: "event_currencies(id)",
      onDelete: "CASCADE",
    },
    /** UTC calendar day, matching the daily shop's rotation boundary. */
    drop_date: { type: "date", notNull: true },
    /** Candy from ordinary match drops only; what the daily cap measures. */
    match_earned: { type: "integer", notNull: true, default: 0 },
    /** Amount paid as today's first-win bonus; 0 until it is awarded. */
    first_win_bonus: { type: "integer", notNull: true, default: 0 },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.addConstraint(
    "user_event_currency_daily_drops",
    "user_event_currency_daily_drops_pkey",
    { primaryKey: ["user_id", "currency_id", "drop_date"] }
  );

  pgm.addConstraint(
    "user_event_currency_daily_drops",
    "user_event_currency_daily_drops_amounts_check",
    { check: "match_earned >= 0 AND first_win_bonus >= 0" }
  );
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropTable("user_event_currency_daily_drops");
};
