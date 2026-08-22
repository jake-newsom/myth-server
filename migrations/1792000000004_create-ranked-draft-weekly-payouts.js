/* eslint-disable camelcase */

/**
 * Weekly reward payouts for the Ranked Draft ladder.
 *
 * Seasonal rewards already have a home (season_reward_payouts), but weekly
 * payouts need their own ledger because they recur inside a season.
 *
 * The table exists for exactly one reason: idempotency. The payout job walks a
 * leaderboard and sends mail, and if it dies halfway through it must be safe to
 * run again — UNIQUE(week_key, user_id) is what makes the second run a no-op
 * for everyone already paid, the same guarantee season_reward_payouts gives the
 * seasonal job.
 *
 * `week_key` is an ISO week string (e.g. "2026-W34") so the natural key is
 * readable in the database and independent of when the job actually ran.
 *
 * Release-safety: new table, written only by the weekly job, which is itself
 * behind the `ranked-draft-rewards` flag.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable("ranked_draft_weekly_payouts", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("uuid_generate_v4()"),
    },
    week_key: { type: "varchar(12)", notNull: true },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(user_id)",
      onDelete: "CASCADE",
    },
    season: { type: "varchar(20)", notNull: true },
    rank_position: { type: "integer", notNull: true },
    rating: { type: "integer", notNull: true },
    tier_label: { type: "varchar(40)", notNull: true },
    reward_gems: { type: "integer", notNull: true, default: 0 },
    reward_packs: { type: "integer", notNull: true, default: 0 },
    mail_id: { type: "uuid", notNull: false },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  // The idempotency guarantee.
  pgm.addConstraint(
    "ranked_draft_weekly_payouts",
    "ranked_draft_weekly_payouts_week_user_unique",
    { unique: ["week_key", "user_id"] }
  );

  pgm.createIndex("ranked_draft_weekly_payouts", ["week_key", "rank_position"], {
    name: "ranked_draft_weekly_payouts_week_rank_idx",
  });
};

exports.down = (pgm) => {
  pgm.dropTable("ranked_draft_weekly_payouts");
};
