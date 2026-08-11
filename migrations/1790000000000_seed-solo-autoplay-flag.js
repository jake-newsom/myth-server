/* eslint-disable camelcase */

/**
 * Seeds the `solo-autoplay` feature flag, dark.
 *
 * Autoplay lets a player hand their own solo turn to the AI engine (see
 * submitAIAction in game.controller.ts). Seeding the row here means the flag
 * can be flipped per-user from the admin console without hand-written SQL;
 * enabled_globally defaults to false, so shipping this migration changes
 * nothing about live behaviour.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO feature_flags (key, description, enabled_globally)
    VALUES (
      'solo-autoplay',
      'Lets a player turn on Autoplay in solo games, handing their own turns to the AI engine.',
      false
    )
    ON CONFLICT (key) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DELETE FROM feature_flags WHERE key = 'solo-autoplay';`);
};
