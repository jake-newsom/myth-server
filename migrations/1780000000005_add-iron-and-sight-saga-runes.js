/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`ALTER TYPE saga_rune_type ADD VALUE IF NOT EXISTS 'iron'`);
  pgm.sql(`ALTER TYPE saga_rune_type ADD VALUE IF NOT EXISTS 'sight'`);
};

exports.down = () => {
  // PostgreSQL does not support removing enum values in-place safely.
};
