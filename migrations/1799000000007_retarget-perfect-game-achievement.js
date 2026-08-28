/* eslint-disable camelcase */

/**
 * Reword and re-cost the `perfect_game` achievement.
 *
 * ## The copy was describing a different achievement
 *
 * "Win a game without losing any cards" reads as "none of YOUR cards were ever
 * flipped". The mechanic is, and always was, about the OPPONENT: the tracking
 * condition is `loserScore === 0`, and scores count cards owned on the board
 * (game.validators.calculateScores). So it fires when the opponent finishes
 * owning nothing.
 *
 * ## The tracking was also wrong, and is fixed alongside this
 *
 * achievement.service.handleGameVictory previously required
 * `winnerScore === 16 && loserScore === 0`. The 16 demanded a completely full
 * 4x4 board, so the achievement could never fire on a 3x3 board (9 tiles), nor
 * on any 4x4 shutout that left a tile empty. A 12-0 or 6-0 is exactly as
 * flawless as a 16-0. That guard is now `loserScore === 0 && winnerScore > 0`.
 *
 * Separately, saga battles never fired achievement events at all — the
 * controller's saga branch skips GameRewardsService.processGameCompletion. That
 * is fixed by GameRewardsService.processSagaAchievements.
 *
 * ## Rewards
 *
 * 400 gems / 2 packs / 50 fragments -> 1000 gems / 10 packs / 0 fragments.
 *
 * Fragments are deliberately dropped rather than kept: the achievement is being
 * repositioned as a chunky gems+packs prize, and gems/packs are the currencies
 * the reward UI leads with.
 *
 * NOTE: no back-pay. Anyone who already completed AND claimed this at the old
 * values keeps what they were paid; the new values apply to future claims only.
 * This is a deliberate departure from the 2026-08-17 re-cost, which mailed the
 * difference via scripts/backfill-achievement-rewards.ts.
 *
 * `target_value` is untouched (1) — this is a single-shot achievement, so no
 * player's progress is reset and nothing completed becomes incomplete.
 *
 * Idempotent: a straight UPDATE keyed by achievement_key.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    UPDATE achievements
    SET title = 'Flawless Victory',
        description = 'Win a game where your opponent controls no cards.',
        reward_gems = 1000,
        reward_packs = 10,
        reward_card_fragments = 0,
        updated_at = NOW()
    WHERE achievement_key = 'perfect_game';
  `);
};

exports.down = (pgm) => {
  // Restores the values set by scripts/achievements-rework.sql (the 2026-08-17
  // re-cost), which is what was live immediately before this migration.
  pgm.sql(`
    UPDATE achievements
    SET title = 'Perfect Game',
        description = 'Win a game without losing any cards',
        reward_gems = 400,
        reward_packs = 2,
        reward_card_fragments = 50,
        updated_at = NOW()
    WHERE achievement_key = 'perfect_game';
  `);
};
