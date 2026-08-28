/* eslint-disable camelcase */

/**
 * Reword the three set-collection achievements from "collect every character in
 * the set" to "collect 30 different characters".
 *
 * ## Why this is copy-only
 *
 * 1772700000000 already seeded these with `target_value = 30`, and
 * `achievement.service.handleCardCollected` already tracks them as "distinct
 * characters owned in that set" (mode `set`, keyed `collect_<slug>_set`). The
 * MECHANIC is already "30 different", because 30 happened to be the size of
 * each set at the time.
 *
 * What is wrong is only the title and description, which promise completion of
 * the whole set. As new characters are added to a set, that promise silently
 * becomes false — the achievement would complete at 30 of 40 while claiming the
 * player owns them all, and we would otherwise have to decide whether to move
 * the goalposts on players mid-progress every time we ship a character.
 *
 * Fixing the copy instead of the target means: no player's progress is reset, no
 * completed achievement becomes incomplete, and the shop rotation (which
 * guarantees every legendary/epic appears within one cycle, and the Soul Shop
 * which always stocks every common/rare) is enough to make the achievement
 * reachable without gacha luck — the requirement for the Japan release.
 *
 * Idempotent: a straight UPDATE keyed by achievement_key.
 */

exports.shorthands = undefined;

const SETS = [
  { key: "collect_norse_set", display: "Norse" },
  { key: "collect_japanese_set", display: "Japanese" },
  { key: "collect_polynesian_set", display: "Polynesian" },
];

const TARGET = 30;

exports.up = (pgm) => {
  for (const s of SETS) {
    pgm.sql(`
      UPDATE achievements
      SET title = '${s.display} Devotee',
          description = 'Collect ${TARGET} different ${s.display} characters.',
          target_value = ${TARGET},
          updated_at = NOW()
      WHERE achievement_key = '${s.key}';
    `);
  }
};

exports.down = (pgm) => {
  for (const s of SETS) {
    pgm.sql(`
      UPDATE achievements
      SET title = '${s.display} Collector',
          description = 'Collect at least one copy of each character in the ${s.display} set.',
          updated_at = NOW()
      WHERE achievement_key = '${s.key}';
    `);
  }
};
