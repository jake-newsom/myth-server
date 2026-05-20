/**
 * Add released_at to characters and card_variants.
 * Existing rows are backfilled to 2025-01-01 so current content stays visible.
 *
 * Visibility rule (application layer): released_at <= NOW()
 * Future-dated released_at = scheduled / unreleased catalog entry.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

const BACKFILL_RELEASED_AT = "2025-01-01T00:00:00Z";

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.addColumn("characters", {
    released_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  pgm.addColumn("card_variants", {
    released_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  pgm.sql(`
    UPDATE characters SET released_at = '${BACKFILL_RELEASED_AT}'::timestamptz;
    UPDATE card_variants SET released_at = '${BACKFILL_RELEASED_AT}'::timestamptz;
  `);

  pgm.createIndex("characters", "released_at");
  pgm.createIndex("card_variants", "released_at");
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropIndex("card_variants", "released_at");
  pgm.dropIndex("characters", "released_at");
  pgm.dropColumn("card_variants", "released_at");
  pgm.dropColumn("characters", "released_at");
};
