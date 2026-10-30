/* eslint-disable camelcase */

/**
 * "Eye of the Oracle": granted by RiddleService at 26 total Weekly Riddle
 * clears. Sheet cell (4, 2).
 *
 * Additive only: one new frame row.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO avatar_frames (code_key, name, description, sprite_key, sort_order)
    VALUES ('oracle_eye', 'Eye of the Oracle',
            'Solved 26 Weekly Riddles. The Oracle watches you back.',
            'oracle_eye', 22)
    ON CONFLICT (code_key) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DELETE FROM avatar_frames WHERE code_key = 'oracle_eye';`);
};
