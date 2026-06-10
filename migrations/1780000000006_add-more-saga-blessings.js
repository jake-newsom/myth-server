/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`ALTER TYPE saga_rune_type ADD VALUE IF NOT EXISTS 'thorns'`);
  pgm.sql(`ALTER TYPE saga_rune_type ADD VALUE IF NOT EXISTS 'first'`);
  pgm.sql(`ALTER TYPE saga_rune_type ADD VALUE IF NOT EXISTS 'bonds'`);
  pgm.sql(`ALTER TYPE saga_rune_type ADD VALUE IF NOT EXISTS 'underdog'`);
};

exports.down = () => {
  // PostgreSQL does not support removing enum values in-place safely.
};
