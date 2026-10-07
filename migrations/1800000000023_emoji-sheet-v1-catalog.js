/* eslint-disable camelcase */

/**
 * Fills the emoji catalog for the first real sprite sheet (6x7, 42 cells)
 * and makes every emoji a free starter.
 *
 * The 8 placeholder rows from 1800000000022 keep their ids (users may have
 * them in quick_emojis) and now cover cells 0-7 of the new art, so they're
 * just renamed. Names are display-only (aria labels).
 */

exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.sql(`
    UPDATE emojis e
       SET name = v.name
      FROM (VALUES
        ('thumbs_up', 'Loki 1'), ('laugh', 'Loki 2'), ('wow', 'Loki 3'),
        ('gg', 'Loki 4'), ('angry', 'Loki 5'), ('cry', 'Loki 6'),
        ('think', 'Thor 1'), ('cool', 'Thor 2')
      ) AS v(emoji_id, name)
     WHERE e.emoji_id = v.emoji_id;
  `);

  pgm.sql(`
    INSERT INTO emojis (emoji_id, name, sheet_index, is_default, sort_order) VALUES
      ('emoji_08', 'Thor 3', 8, true, 8),
      ('emoji_09', 'Thor 4', 9, true, 9),
      ('emoji_10', 'Thor 5', 10, true, 10),
      ('emoji_11', 'Thor 6', 11, true, 11),
      ('emoji_12', 'Maui 1', 12, true, 12),
      ('emoji_13', 'Maui 2', 13, true, 13),
      ('emoji_14', 'Maui 3', 14, true, 14),
      ('emoji_15', 'Maui 4', 15, true, 15),
      ('emoji_16', 'Maui 5', 16, true, 16),
      ('emoji_17', 'Maui 6', 17, true, 17),
      ('emoji_18', 'Pele 1', 18, true, 18),
      ('emoji_19', 'Pele 2', 19, true, 19),
      ('emoji_20', 'Pele 3', 20, true, 20),
      ('emoji_21', 'Pele 4', 21, true, 21),
      ('emoji_22', 'Pele 5', 22, true, 22),
      ('emoji_23', 'Pele 6', 23, true, 23),
      ('emoji_24', 'Susanoo 1', 24, true, 24),
      ('emoji_25', 'Susanoo 2', 25, true, 25),
      ('emoji_26', 'Susanoo 3', 26, true, 26),
      ('emoji_27', 'Susanoo 4', 27, true, 27),
      ('emoji_28', 'Susanoo 5', 28, true, 28),
      ('emoji_29', 'Susanoo 6', 29, true, 29),
      ('emoji_30', 'Amaterasu 1', 30, true, 30),
      ('emoji_31', 'Amaterasu 2', 31, true, 31),
      ('emoji_32', 'Amaterasu 3', 32, true, 32),
      ('emoji_33', 'Amaterasu 4', 33, true, 33),
      ('emoji_34', 'Amaterasu 5', 34, true, 34),
      ('emoji_35', 'Amaterasu 6', 35, true, 35),
      ('emoji_36', 'Hel 1', 36, true, 36),
      ('emoji_37', 'Hel 2', 37, true, 37),
      ('emoji_38', 'Hel 3', 38, true, 38),
      ('emoji_39', 'Hel 4', 39, true, 39),
      ('emoji_40', 'Hel 5', 40, true, 40),
      ('emoji_41', 'Hel 6', 41, true, 41)
    ON CONFLICT (emoji_id) DO NOTHING;
  `);

  pgm.sql(`UPDATE emojis SET is_default = true;`);
};

exports.down = (pgm) => {
  pgm.sql(`DELETE FROM emojis WHERE emoji_id LIKE 'emoji\\_%';`);
  pgm.sql(`
    UPDATE emojis SET is_default = false
     WHERE emoji_id IN ('angry', 'cry', 'think', 'cool');
  `);
};
