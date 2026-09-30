/* eslint-disable camelcase */

/**
 * Hallow's Eve cosmetics: final art paths.
 *
 * 1800000000003 seeded both cosmetics with placeholder image paths. These are
 * the final ones, matched by natural key (back code_key, border name).
 *
 * How each is earned is unchanged: the card back is sold in the event shop
 * (slot 11, from 1800000000017) and the Hallowed Veil border is the 900-Candy
 * milestone reward only.
 */

exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.sql(`
    UPDATE card_backs
       SET image_url = 'assets/cards/halloween/hallows-eve.webp'
     WHERE code_key = 'halloween-2026-back';
  `);

  pgm.sql(`
    UPDATE card_borders
       SET image_url = 'assets/borders/halloween-frame.png'
     WHERE name = 'Hallowed Veil';
  `);
};

// The old paths were placeholders pointing at nothing, so there is nothing to
// restore.
exports.down = () => {};
