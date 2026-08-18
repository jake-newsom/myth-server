/* eslint-disable camelcase */

/**
 * Encounter Modifiers for tower floors.
 *
 * Every 5th floor past 100 can carry up to 2 modifiers that either restrict the
 * player's deck (checked at POST /tower/start) or apply an in-battle status.
 *
 * Stored as JSONB rather than a set of typed columns because the modifier set is
 * a discriminated union that will grow — a new modifier type must not require a
 * migration. Each entry carries its own display `label`/`description` so an old
 * client can render a modifier type it has never heard of, and so copy can be
 * retuned without an app release.
 *
 * Additive and release-safe: the column is nullable with no default backfill, so
 * every existing floor reads as "no modifiers" and old clients ignore the field.
 *
 * The `tower-encounter-modifiers` flag is seeded dark. With it off the server
 * omits the field entirely, skips the new validation, and never writes
 * tower_context into game_state — i.e. current behaviour, byte for byte.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.addColumn("tower_floors", {
    modifiers: {
      type: "jsonb",
      notNull: false,
      default: null,
      comment:
        "Encounter modifiers, max 2 (at most one deck-restriction). null/[] = none.",
    },
  });

  pgm.sql(`
    INSERT INTO feature_flags (key, description, enabled_globally)
    VALUES (
      'tower-encounter-modifiers',
      'Tower Encounter Modifiers: per-floor deck restrictions and in-battle statuses on every 5th floor past 100.',
      false
    )
    ON CONFLICT (key) DO NOTHING;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.sql(`DELETE FROM feature_flags WHERE key = 'tower-encounter-modifiers';`);
  pgm.dropColumn("tower_floors", "modifiers", { ifExists: true });
};
