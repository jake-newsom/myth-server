/**
 * Add the OnMove family to the `trigger_moment` enum.
 *
 * `special_abilities.trigger_moments` is an ARRAY of this enum (udt
 * `_trigger_moment`), not text[], so pointing an ability at a trigger the enum
 * does not carry fails outright with 22P02 invalid_text_representation. This
 * must therefore run BEFORE the ability patch that gives Ukupanipo
 * {AnyOnPlace,AnyOnMove}.
 *
 * OnMove fires when a card CHANGES TILES -- pushed, pulled or self-moved. It is
 * deliberately separate from the OnPlace family: playing a card from hand is not
 * movement, so an ability that must react to both entry paths (Ukupanipo
 * debuffing non-SEA enemies that enter WATER) carries a trigger from each.
 *
 * Purely additive. No existing ability references these values, so until a row
 * is patched to use one this migration changes no behavior.
 *
 * NOTE: adding a value to an enum cannot run inside a transaction block on
 * older PostgreSQL, so deploy with the --no-single-transaction runner
 * (npm run migrate:up:enum / migrate:deploy), as the terrain-trigger and
 * mulligan-status migrations do.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

const MOVE_TRIGGERS = ["OnMove", "AnyOnMove", "HandOnMove"];

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  for (const value of MOVE_TRIGGERS) {
    pgm.addTypeValue("trigger_moment", value, { ifNotExists: true });
  }
  console.log(`✓ Added ${MOVE_TRIGGERS.join(", ")} to trigger_moment enum`);
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
          WHERE tm::text NOT IN ('OnMove', 'AnyOnMove', 'HandOnMove')
       )
     WHERE trigger_moments && ARRAY['OnMove','AnyOnMove','HandOnMove']::trigger_moment[]
  `);
  console.log(
    "⚠ Stripped move triggers from abilities. Enum values remain (PostgreSQL limitation)."
  );
};
