/* eslint-disable camelcase */

/**
 * Separates "how many cards" from "at what level" for the level_* achievement
 * families (level_rare, level_epic, level_legendary).
 *
 * These twelve achievements read "Reach level N with 20 <rarity> cards", which
 * is two numbers. The schema only had one: target_value held the LEVEL (2/3/4/5)
 * and the count of 20 existed nowhere in the database — it was a hardcoded
 * `>= 20` inside AchievementService.handleCardLeveled.
 *
 * That is unrepresentable, because completion everywhere is
 * `current_progress >= target_value` (achievement.model.ts) and the client
 * renders `current_progress / target_value` (client achievement.types.ts). With
 * the level in target_value, "Reach level 2 with 20 epic cards" completes at
 * progress 2 and displays "x / 2" — it can never show progress toward 20, and a
 * player with 2 epic cards could complete it.
 *
 * So: target_value becomes the COUNT (20), and the level moves to the new
 * level_requirement column. The bar then reads "5 / 20" like every other
 * achievement in the app, and completion means what the description says.
 *
 * Additive and backward-compatible per the API contract rules:
 *   - level_requirement is nullable with no default. Every non-level_* row
 *     leaves it NULL, and all existing code ignores the column.
 *   - No column is removed, renamed, or retyped.
 *   - target_value stays an int and stays "the number progress is compared
 *     against". Its MEANING changes for these twelve rows only, and no shipped
 *     client hardcodes those values — the client reads target_value generically
 *     and renders whatever it is told.
 *
 * The target_value rewrite is in this migration rather than a separate backfill
 * because these rows are definitions, not user data, and no deployed code reads
 * level_requirement yet. There is no shipped reader to race with. User progress
 * is backfilled separately, AFTER this deploys, by
 * scripts/backfill-level-and-completionist-achievements.ts.
 *
 * Old clients during rollout: these twelve achievements have no user_achievements
 * rows at all today (nothing has ever written to them — see the migration note
 * in that backfill script), so an old client can only render them as 0 / 20
 * instead of 0 / 2. Nothing regresses; a stuck-at-zero bar becomes a
 * correctly-scaled stuck-at-zero bar until the backfill runs.
 */

exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.addColumns("achievements", {
    level_requirement: {
      type: "integer",
      notNull: false,
      default: null,
      comment:
        "For achievements that require N cards to reach a given level, the " +
        "level each card must reach. NULL for every other achievement. " +
        "target_value holds the card count.",
    },
  });

  // Snapshot the pre-rewrite definitions so the change is reversible and
  // auditable, matching the pattern achievements-rework.sql established with
  // achievements_reward_backup_20260817.
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS achievements_level_target_backup_20260826 AS
    SELECT achievement_key, target_value, level_requirement
    FROM achievements
    WHERE base_achievement_key IN ('level_rare', 'level_epic', 'level_legendary');
  `);

  // Move the level into its own column, then set the count.
  //
  // Ordering matters: level_requirement must be populated FROM target_value
  // before target_value is overwritten with 20.
  //
  // Scoped by base_achievement_key so it cannot touch anything else, and
  // level_requirement IS NULL makes it idempotent — a re-run finds nothing to
  // move and will not stamp 20 into the level column.
  pgm.sql(`
    UPDATE "achievements"
    SET level_requirement = target_value,
        target_value = 20
    WHERE base_achievement_key IN ('level_rare', 'level_epic', 'level_legendary')
      AND level_requirement IS NULL;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  // Restore target_value from the snapshot before dropping the column that
  // holds the level, otherwise the level is lost.
  pgm.sql(`
    UPDATE "achievements" a
    SET target_value = b.target_value
    FROM achievements_level_target_backup_20260826 b
    WHERE a.achievement_key = b.achievement_key;
  `);

  pgm.dropTable("achievements_level_target_backup_20260826", { ifExists: true });
  pgm.dropColumns("achievements", ["level_requirement"]);
};
