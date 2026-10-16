/* eslint-disable camelcase */

/**
 * Fenrir (Devourer's Surge) and Nurarihyon (Supreme Commander) now trigger at
 * the end of their owner's turn instead of at round end.
 *
 * OnTurnEnd is already owner-gated in triggerIndirectAbilities, so the handlers
 * need no change. Nurarihyon may already be OnTurnEnd in some environments;
 * setting it again is a no-op there.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    UPDATE special_abilities
       SET description = 'Turn End: DESTROY a weaker adjacent enemy to gain +1 power.',
           trigger_moments = ARRAY['OnTurnEnd']::trigger_moment[]
     WHERE id = 'fenrir_devourer_surge';
  `);
  pgm.sql(`
    UPDATE special_abilities
       SET description = 'At the end of your turns: Steal a BUFF from a random enemy.',
           trigger_moments = ARRAY['OnTurnEnd']::trigger_moment[]
     WHERE id = 'nurarihyon_slipstream';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    UPDATE special_abilities
       SET description = 'Round end: DESTROY a weaker adjacent enemy to gain +1 power.',
           trigger_moments = ARRAY['OnRoundEnd']::trigger_moment[]
     WHERE id = 'fenrir_devourer_surge';
  `);
};
