/* eslint-disable camelcase */

/**
 * In-game emojis.
 *
 * `emojis` is the catalog. Each row points at one cell of the client's emoji
 * sprite sheet (sheet_index = row * columns + col), so growing the sheet is an
 * asset append plus new rows here. Defaults are owned by everyone without a
 * user_emojis row; anything else is unlocked via user_emojis.
 *
 * users.quick_emojis holds the player's 4 quick slots (NULL = defaults) and
 * users.hide_opponent_emojis is the global "don't show me theirs" setting.
 * All additive: nothing existing reads these.
 */

exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.createTable("emojis", {
    emoji_id: { type: "text", primaryKey: true },
    name: { type: "text", notNull: true },
    sheet_index: { type: "integer", notNull: true, unique: true },
    is_default: { type: "boolean", notNull: true, default: false },
    is_active: { type: "boolean", notNull: true, default: true },
    sort_order: { type: "integer", notNull: true, default: 0 },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.createTable(
    "user_emojis",
    {
      user_id: {
        type: "uuid",
        notNull: true,
        references: "users(user_id)",
        onDelete: "CASCADE",
      },
      emoji_id: {
        type: "text",
        notNull: true,
        references: "emojis(emoji_id)",
        onDelete: "CASCADE",
      },
      source: { type: "text" },
      acquired_at: {
        type: "timestamptz",
        notNull: true,
        default: pgm.func("now()"),
      },
    },
    { constraints: { primaryKey: ["user_id", "emoji_id"] } }
  );

  pgm.addColumns("users", {
    quick_emojis: { type: "text[]" },
    hide_opponent_emojis: { type: "boolean", notNull: true, default: false },
  });

  // Placeholder catalog until the real sheet ships; the first four are the
  // starter set everyone owns.
  pgm.sql(`
    INSERT INTO emojis (emoji_id, name, sheet_index, is_default, sort_order) VALUES
      ('thumbs_up', 'Thumbs Up', 0, true, 0),
      ('laugh',     'Laugh',     1, true, 1),
      ('wow',       'Wow',       2, true, 2),
      ('gg',        'GG',        3, true, 3),
      ('angry',     'Angry',     4, false, 4),
      ('cry',       'Cry',       5, false, 5),
      ('think',     'Thinking',  6, false, 6),
      ('cool',      'Cool',      7, false, 7)
    ON CONFLICT (emoji_id) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.dropColumns("users", ["quick_emojis", "hide_opponent_emojis"]);
  pgm.dropTable("user_emojis");
  pgm.dropTable("emojis");
};
