/* eslint-disable camelcase */

/**
 * Avatar frame sprite sheet v1 (client: public/assets/profile/frames.webp).
 *
 * Row 1: ten generic frames. The first (bronze) is the default every player
 * owns — `is_default` makes it owned without a user_owned_frames row, and it
 * is what a player with nothing equipped displays.
 * Row 2: ten decorative frames, unowned until an unlock source is assigned
 * (achievement / season tier / event reward columns, or admin grant).
 *
 * sprite_key === code_key and must match profileSprites.ts FRAME_SHEET cells.
 * Bronze/silver/gold already exist from 1800000000030 and are updated in place.
 */

exports.shorthands = undefined;

const FRAMES = [
  // Row 1 — generic
  ["bronze", "Bronze Ring", "The ring every bearer begins with."],
  ["silver", "Silver Ring", null],
  ["gold", "Gold Ring", null],
  ["jade", "Jade Ring", null],
  ["sapphire", "Sapphire Ring", null],
  ["amethyst", "Amethyst Ring", null],
  ["emerald", "Emerald Ring", null],
  ["ember", "Ember Ring", null],
  ["ivory", "Ivory Ring", null],
  ["crimson", "Crimson Ring", null],
  // Row 2 — decorative
  ["ravens", "Huginn & Muninn", null],
  ["sakura", "Sakura Bough", null],
  ["tide", "Ocean Tide", null],
  ["jormungandr", "World Serpent", null],
  ["inferno", "Inferno", null],
  ["oni", "Oni Mask", null],
  ["bifrost", "Bifröst", null],
  ["kitsune", "Kitsune Shrine", null],
  ["tusk", "Island Tusk", null],
  ["spirit", "Restless Spirit", null],
];

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE avatar_frames
      ADD COLUMN is_default boolean NOT NULL DEFAULT false,
      ADD COLUMN sort_order integer NOT NULL DEFAULT 0;
  `);

  const values = FRAMES.map(
    ([code, name, desc], i) =>
      `('${code}', '${name.replace(/'/g, "''")}', ${
        desc ? `'${desc.replace(/'/g, "''")}'` : "NULL"
      }, ${i + 1}, ${i === 0})`
  ).join(",\n      ");

  pgm.sql(`
    INSERT INTO avatar_frames (code_key, name, description, sort_order, is_default, sprite_key)
    SELECT v.code_key, v.name, v.description, v.sort_order, v.is_default, v.code_key
      FROM (VALUES
      ${values}
      ) AS v(code_key, name, description, sort_order, is_default)
    ON CONFLICT (code_key) DO UPDATE
      SET name = EXCLUDED.name,
          description = EXCLUDED.description,
          sort_order = EXCLUDED.sort_order,
          is_default = EXCLUDED.is_default,
          sprite_key = EXCLUDED.sprite_key;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM avatar_frames
     WHERE code_key IN (${FRAMES.slice(3).map(([c]) => `'${c}'`).join(", ")});
    ALTER TABLE avatar_frames DROP COLUMN IF EXISTS is_default,
                              DROP COLUMN IF EXISTS sort_order;
  `);
};
