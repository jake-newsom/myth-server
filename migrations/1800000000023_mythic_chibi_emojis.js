/* eslint-disable camelcase */

/** Replace the temporary eight-cell catalog with the 42-cell Mythic Chibi sheet. */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  // The previous migration seeded placeholders only. Every cell in the real
  // sheet is a default cosmetic, so reset the placeholder catalog and make the
  // complete sheet available to every player.
  pgm.sql(`
    DELETE FROM user_emojis;
    UPDATE users SET quick_emojis = NULL;
    DELETE FROM emojis;

    INSERT INTO emojis (emoji_id, name, sheet_index, is_default, sort_order) VALUES
      ('loki_01', 'Loki 1', 0, true, 0),
      ('loki_02', 'Loki 2', 1, true, 1),
      ('loki_03', 'Loki 3', 2, true, 2),
      ('loki_04', 'Loki 4', 3, true, 3),
      ('loki_05', 'Loki 5', 4, true, 4),
      ('loki_06', 'Loki 6', 5, true, 5),
      ('thor_01', 'Thor 1', 6, true, 6),
      ('thor_02', 'Thor 2', 7, true, 7),
      ('thor_03', 'Thor 3', 8, true, 8),
      ('thor_04', 'Thor 4', 9, true, 9),
      ('thor_05', 'Thor 5', 10, true, 10),
      ('thor_06', 'Thor 6', 11, true, 11),
      ('ku_01', 'Ku 1', 12, true, 12),
      ('ku_02', 'Ku 2', 13, true, 13),
      ('ku_03', 'Ku 3', 14, true, 14),
      ('ku_04', 'Ku 4', 15, true, 15),
      ('ku_05', 'Ku 5', 16, true, 16),
      ('ku_06', 'Ku 6', 17, true, 17),
      ('pele_01', 'Pele 1', 18, true, 18),
      ('pele_02', 'Pele 2', 19, true, 19),
      ('pele_03', 'Pele 3', 20, true, 20),
      ('pele_04', 'Pele 4', 21, true, 21),
      ('pele_05', 'Pele 5', 22, true, 22),
      ('pele_06', 'Pele 6', 23, true, 23),
      ('susanoo_01', 'Susanoo 1', 24, true, 24),
      ('susanoo_02', 'Susanoo 2', 25, true, 25),
      ('susanoo_03', 'Susanoo 3', 26, true, 26),
      ('susanoo_04', 'Susanoo 4', 27, true, 27),
      ('susanoo_05', 'Susanoo 5', 28, true, 28),
      ('susanoo_06', 'Susanoo 6', 29, true, 29),
      ('amaterasu_01', 'Amaterasu 1', 30, true, 30),
      ('amaterasu_02', 'Amaterasu 2', 31, true, 31),
      ('amaterasu_03', 'Amaterasu 3', 32, true, 32),
      ('amaterasu_04', 'Amaterasu 4', 33, true, 33),
      ('amaterasu_05', 'Amaterasu 5', 34, true, 34),
      ('amaterasu_06', 'Amaterasu 6', 35, true, 35),
      ('hel_01', 'Hel 1', 36, true, 36),
      ('hel_02', 'Hel 2', 37, true, 37),
      ('hel_03', 'Hel 3', 38, true, 38),
      ('hel_04', 'Hel 4', 39, true, 39),
      ('hel_05', 'Hel 5', 40, true, 40),
      ('hel_06', 'Hel 6', 41, true, 41)
    ON CONFLICT (emoji_id) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM user_emojis;
    UPDATE users SET quick_emojis = NULL;
    DELETE FROM emojis;
    INSERT INTO emojis (emoji_id, name, sheet_index, is_default, sort_order) VALUES
      ('thumbs_up', 'Thumbs Up', 0, true, 0),
      ('laugh', 'Laugh', 1, true, 1),
      ('wow', 'Wow', 2, true, 2),
      ('gg', 'GG', 3, true, 3),
      ('angry', 'Angry', 4, false, 4),
      ('cry', 'Cry', 5, false, 5),
      ('think', 'Thinking', 6, false, 6),
      ('cool', 'Cool', 7, false, 7);
  `);
};
