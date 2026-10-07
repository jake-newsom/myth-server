/* eslint-disable camelcase */

/**
 * "Ring of the Fallen Sovereign": granted permanently to anyone who has held
 * the One Frame and lost it (defeat, inactivity, or admin move — not account
 * reset). Granted by UniqueFrameService.transfer. Sheet cell (2, 2); the One
 * Frame itself now has art at (3, 2).
 *
 * Backfills past holders from unique_frame_history.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO avatar_frames (code_key, name, description, sprite_key, sort_order)
    VALUES ('fallen_sovereign', 'Ring of the Fallen Sovereign',
            'Once you held the One Frame. The crown is gone; the ring remembers.',
            'fallen_sovereign', 21)
    ON CONFLICT (code_key) DO NOTHING;

    INSERT INTO user_owned_frames (user_id, frame_id, source)
    SELECT DISTINCT h.from_user_id, f.frame_id, 'one_frame_lost'
      FROM unique_frame_history h
      JOIN avatar_frames f ON f.code_key = 'fallen_sovereign'
     WHERE h.from_user_id IS NOT NULL AND h.reason <> 'release'
    ON CONFLICT DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DELETE FROM avatar_frames WHERE code_key = 'fallen_sovereign';`);
};
