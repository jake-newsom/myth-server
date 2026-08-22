/* eslint-disable camelcase */

/**
 * Seeds the Ranked Draft feature flags, dark.
 *
 * Two flags rather than one, so the reward jobs can be killed without taking
 * the mode itself offline:
 *
 *   ranked-draft-pvp      master gate — the hub entry point, queue admission,
 *                         draft sockets and routes. Off => the mode does not
 *                         exist as far as any client can tell.
 *   ranked-draft-rewards  the weekly/seasonal payout jobs only.
 *
 * Seeding the ROWS (rather than relying on "unknown key => false") is what lets
 * the flags be flipped per-user from the admin console for testing, with no
 * hand-written SQL. enabled_globally defaults to false, so shipping this
 * changes nothing about live behaviour.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO feature_flags (key, description, enabled_globally)
    VALUES
      (
        'ranked-draft-pvp',
        'Ranked Draft PvP: ban phase, catalog draft, separate Elo ladder and matchmaking queue.',
        false
      ),
      (
        'ranked-draft-rewards',
        'Weekly and seasonal reward payouts for the Ranked Draft ladder.',
        false
      )
    ON CONFLICT (key) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM feature_flags
    WHERE key IN ('ranked-draft-pvp', 'ranked-draft-rewards');
  `);
};
