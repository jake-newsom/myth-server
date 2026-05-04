/**
 * Backfill progress for the three "collect the set" standard achievements
 * (`collect_norse_set`, `collect_japanese_set`, `collect_polynesian_set`)
 * for every existing user in the database.
 *
 * Why
 * ---
 * Those achievements were introduced in
 * `1772700000000_add-set-collection-achievements`. Progress is normally pushed
 * forward by the `card_collected` event handler in `AchievementService`, which
 * means a user only starts accruing progress after they open another pack.
 * Anyone who already collected a full set before the achievement existed would
 * see 0/30 forever despite owning the cards.
 *
 * What this migration does
 * ------------------------
 * For every (user, set) pair where the user already owns at least one copy of
 * any character in that set, upsert a `user_achievements` row whose
 * `current_progress` matches the actual distinct-character count, capped at
 * the achievement's `target_value`. `is_completed` is derived from progress vs.
 * target so users who already own all 30 characters end up with the
 * achievement marked complete and ready to claim.
 *
 * What this migration does NOT do
 * -------------------------------
 * - It does NOT auto-claim. `is_claimed`, `claimed_at`, and the reward grants
 *   (gems / border) are intentionally left untouched so users go through the
 *   normal claim flow from the achievements panel.
 * - It does NOT touch users who own 0 characters in a set, to avoid creating
 *   noise rows.
 * - It does NOT lower progress: if a user already has more progress recorded
 *   for some reason, the existing value is preserved (`GREATEST`).
 *
 * Idempotency
 * -----------
 * - The unique key on `user_achievements (user_id, achievement_id)` plus the
 *   `ON CONFLICT DO UPDATE` clause makes re-runs safe.
 * - On a fresh production database the underlying `card_collected` flow has
 *   already kept new users in sync, so this migration is effectively a no-op
 *   the first time it runs there for any user who joined after the
 *   set-collection achievements existed.
 * - The `completed_at` column is filled automatically by the existing
 *   `update_user_achievements_updated_at_trigger` companion trigger which sets
 *   it whenever `is_completed` flips false -> true.
 */

exports.shorthands = undefined;

const SET_KEYS = [
  { achievement_key: "collect_norse_set", set_slug: "norse" },
  { achievement_key: "collect_japanese_set", set_slug: "japanese" },
  { achievement_key: "collect_polynesian_set", set_slug: "polynesian" },
];

function buildSetKeyValuesSql() {
  return SET_KEYS.map(
    (k) => `('${k.achievement_key}', '${k.set_slug}')`
  ).join(",\n        ");
}

exports.up = (pgm) => {
  pgm.sql(`
    WITH set_keys (achievement_key, set_slug) AS (
      VALUES
        ${buildSetKeyValuesSql()}
    ),
    set_targets AS (
      SELECT
        a.id           AS achievement_id,
        a.target_value AS target_value,
        sk.set_slug    AS set_slug
      FROM set_keys sk
      JOIN achievements a
        ON a.achievement_key = sk.achievement_key
       AND a.is_active = true
    ),
    user_set_counts AS (
      SELECT
        uoc.user_id,
        lower(s.name)                          AS set_slug,
        COUNT(DISTINCT ch.character_id)::int   AS owned_count
      FROM user_owned_cards uoc
      JOIN card_variants cv  ON cv.card_variant_id = uoc.card_variant_id
      JOIN characters    ch  ON ch.character_id    = cv.character_id
      JOIN sets          s   ON s.set_id           = ch.set_id
      WHERE lower(s.name) IN ('norse', 'japanese', 'polynesian')
      GROUP BY uoc.user_id, lower(s.name)
    )
    INSERT INTO user_achievements (
      user_id,
      achievement_id,
      current_progress,
      is_completed
    )
    SELECT
      usc.user_id,
      st.achievement_id,
      LEAST(usc.owned_count, st.target_value)        AS current_progress,
      usc.owned_count >= st.target_value             AS is_completed
    FROM user_set_counts usc
    JOIN set_targets st ON st.set_slug = usc.set_slug
    WHERE usc.owned_count > 0
    ON CONFLICT (user_id, achievement_id) DO UPDATE
      SET
        current_progress = GREATEST(
          user_achievements.current_progress,
          EXCLUDED.current_progress
        ),
        is_completed = GREATEST(
          user_achievements.current_progress,
          EXCLUDED.current_progress
        ) >= COALESCE(
          (SELECT target_value FROM achievements WHERE id = user_achievements.achievement_id),
          GREATEST(user_achievements.current_progress, EXCLUDED.current_progress)
        ),
        updated_at = NOW();
  `);
};

exports.down = () => {
  // No reversal: by the time this migration is rolled back in any non-trivial
  // environment, users may have already viewed (or claimed) the resulting
  // achievement progress. Deleting / decrementing those rows would silently
  // revoke claimed rewards or surprise the player. Leave the data in place.
};
