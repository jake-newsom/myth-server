/* eslint-disable camelcase */

/**
 * Daily shop can sell avatar frames. On its own because a new enum value
 * cannot be used in the transaction that adds it (see 1800000000036).
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`ALTER TYPE shop_item_type ADD VALUE IF NOT EXISTS 'avatar_frame';`);
};

// Postgres cannot drop an enum value; 1800000000036's down removes every use.
exports.down = () => {};
