/* eslint-disable camelcase */

/**
 * Seasonal reward payouts for the Ranked Draft ladder.
 *
 * Replaces the weekly cadence: the ladder now pays out once per season, on the
 * same quarterly schedule as Season Souls, driven by the season finalizer
 * rather than its own cron.
 *
 * The table exists for exactly one reason: idempotency. The payout job walks a
 * leaderboard and sends mail, and if it dies halfway through it must be safe to
 * run again — UNIQUE(season_id, user_id) is what makes the second run a no-op
 * for everyone already paid, the same guarantee season_reward_payouts gives the
 * souls job.
 *
 * `season_id` is the season_definitions row, so PvP payouts join cleanly
 * against the souls payouts for the same season.
 *
 * `rank_key` records which PvP rank badge the player finished with (see
 * src/config/pvpRanks.ts) — kept alongside the payout band's `tier_label`
 * because the two can differ: rank is the player's own standing, tier_label is
 * the reward bracket they landed in.
 *
 * Release-safety: new table, written only by the seasonal job, which is itself
 * behind the `ranked-draft-rewards` flag. The old
 * `ranked_draft_weekly_payouts` table is intentionally left in place — it is
 * the historical ledger of what was already paid, and dropping it in the same
 * release as the code change would be a destructive migration.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable("ranked_draft_season_payouts", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("uuid_generate_v4()"),
    },
    // text, NOT uuid: season_definitions.season_id has been text since it was
    // created, and 1771500000000 remapped the values to incrementing numeric
    // strings ("1", "2", ...) under a numeric-only CHECK. Matching that type is
    // also what lets this join against season_reward_payouts, which is text too.
    season_id: {
      type: "text",
      notNull: true,
      references: "season_definitions(season_id)",
      onDelete: "CASCADE",
    },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(user_id)",
      onDelete: "CASCADE",
    },
    /** The user_rankings ladder key that was read (e.g. "rd:2026-Q3"). */
    season: { type: "varchar(20)", notNull: true },
    rank_position: { type: "integer", notNull: true },
    rating: { type: "integer", notNull: true },
    tier_label: { type: "varchar(40)", notNull: true },
    rank_key: { type: "varchar(32)", notNull: false },
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
    "ranked_draft_season_payouts",
    "ranked_draft_season_payouts_season_user_unique",
    { unique: ["season_id", "user_id"] }
  );

  pgm.createIndex(
    "ranked_draft_season_payouts",
    ["season_id", "rank_position"],
    { name: "ranked_draft_season_payouts_season_rank_idx" }
  );
};

exports.down = (pgm) => {
  pgm.dropTable("ranked_draft_season_payouts");
};
