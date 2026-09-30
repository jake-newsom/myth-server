/**
 * Add the OnTerrain family to the `trigger_moment` enum.
 *
 * `special_abilities.trigger_moments` is an ARRAY of this enum (udt `_trigger_moment`),
 * not text[], so an ability row cannot reference a trigger the enum does not
 * carry -- the UPDATE fails outright with 22P02 invalid_text_representation.
 *
 * OnTerrain fires when terrain (water/lava/...) is added or changed on one or
 * more tiles. It is deliberately terrain-GENERIC: handlers read
 * `context.terrainEvents` and filter by terrain themselves, so reacting to lava
 * (Pele) and reacting to water are the same trigger rather than one moment per
 * terrain type. Any/Hand variants follow the existing naming convention and are
 * dispatched by the generic `Any${trigger}` / `Hand${trigger}` lookup in
 * triggerIndirectAbilities -- no dispatch code is specific to them.
 *
 * Purely additive: no existing ability references these values, so until a row
 * is patched to use one this migration changes no behavior. Must run BEFORE the
 * ability patch that points Pele at {HandOnTerrain,AnyOnTerrain}.
 *
 * NOTE: adding a value to an enum cannot run inside a transaction block in
 * older PostgreSQL, so deploy this with the --no-single-transaction runner
 * (npm run migrate:up:enum / migrate:deploy) as the mulligan status migration
 * did.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

const TERRAIN_TRIGGERS = ["OnTerrain", "AnyOnTerrain", "HandOnTerrain"];

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  for (const value of TERRAIN_TRIGGERS) {
    pgm.addTypeValue("trigger_moment", value, { ifNotExists: true });
  }
  console.log(`✓ Added ${TERRAIN_TRIGGERS.join(", ")} to trigger_moment enum`);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  // PostgreSQL cannot drop a value from an enum type. Strip the values from any
  // ability that adopted them so nothing references a trigger the running code
  // may no longer dispatch; the labels themselves stay behind harmlessly.
  pgm.sql(`
    UPDATE "special_abilities"
       SET trigger_moments = (
         SELECT COALESCE(array_agg(tm), '{}')::trigger_moment[]
           FROM unnest(trigger_moments) AS tm
          WHERE tm::text NOT IN ('OnTerrain', 'AnyOnTerrain', 'HandOnTerrain')
       )
     WHERE trigger_moments && ARRAY['OnTerrain','AnyOnTerrain','HandOnTerrain']::trigger_moment[]
  `);
  console.log(
    "⚠ Stripped terrain triggers from abilities. Enum values remain (PostgreSQL limitation)."
  );
};
