/**
 * Re-apply the character milestone border + reward-link seeding.
 *
 * Background
 * ----------
 * Migration `1772200000000_add_character_set_achievement_milestones` was
 * iteratively edited after it had already been applied to local databases.
 * Environments that ran the early version of that migration ended up with:
 *
 *   - Only the 3 set-tier borders (and 3 legacy `{set}-mid-ach` borders),
 *     none of the 37 per-character borders that the current version intends.
 *   - Mid-tier achievements pointing at the legacy `{set}-mid-ach` borders
 *     instead of the new `{set}-final-ach` set borders.
 *   - Final-tier achievements pointing at set borders instead of the
 *     character-specific borders that should be the legendary reward.
 *
 * Production has never run `1772200000000`, so on first deploy that migration
 * inserts the correct rows. This migration exists to bring stale local
 * databases back in line with the current intent of the migration file.
 *
 * Implementation
 * --------------
 * The `up()` of `1772200000000` is fully idempotent — every write uses
 * `ON CONFLICT DO UPDATE`. Re-invoking it from this migration:
 *
 *   - Creates the 37 missing per-character borders.
 *   - Renames the 3 set borders to their canonical `{set}-final-ach` names.
 *   - Re-links the mid-tier `reward_border_id` to the set border and the
 *     final-tier `reward_border_id` to the character border.
 *
 * On a fresh database (e.g. production first deploy), this migration is a
 * pure no-op: every UPSERT writes the same value that's already there.
 */

const milestoneSeed = require("./1772200000000_add_character_set_achievement_milestones");

exports.shorthands = undefined;

exports.up = milestoneSeed.up;

exports.down = () => {
  // Intentionally a no-op. Reverting this migration would not undo the
  // original seed (which lives in 1772200000000), and rolling back the
  // achievement → border links has no operational value.
};
