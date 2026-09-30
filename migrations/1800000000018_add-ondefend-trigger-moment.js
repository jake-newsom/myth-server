/**
 * Add the missing `OnDefend` value to the `trigger_moment` enum.
 *
 * This is a pre-existing gap between the code and the database, not a new
 * trigger. The TypeScript TriggerMoment enum has had OnDefend for a long time
 * and the engine dispatches it from both defeat-prevention paths in
 * game.utils.ts (resolveCombat's plain-defend branch, and buildDefendedEvents
 * when a combat resolver prevents the flip). The enum only ever received the
 * `AnyOnDefend` and `HandOnDefend` variants, so the base value was unusable.
 *
 * It went unnoticed because no ability referenced any Defend trigger. Kamohoali'i
 * is the first ("On DEFEND: grant +2 to a random SEA card in your hand"), and
 * pointing him at it fails with 22P02 invalid_text_representation until this
 * runs.
 *
 * Purely additive and independently safe: adding the label changes nothing until
 * an ability row uses it.
 *
 * NOTE: adding a value to an enum cannot run inside a transaction block on older
 * PostgreSQL, so deploy with the --no-single-transaction runner
 * (npm run migrate:up:enum / migrate:deploy).
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.addTypeValue("trigger_moment", "OnDefend", { ifNotExists: true });
  console.log('✓ Added "OnDefend" to trigger_moment enum');
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  // PostgreSQL cannot drop a value from an enum type. Strip it from any ability
  // that adopted it; the label itself stays behind harmlessly.
  pgm.sql(`
    UPDATE "special_abilities"
       SET trigger_moments = (
         SELECT COALESCE(array_agg(tm), '{}')::trigger_moment[]
           FROM unnest(trigger_moments) AS tm
          WHERE tm::text <> 'OnDefend'
       )
     WHERE 'OnDefend' = ANY(trigger_moments::text[])
  `);
  console.log(
    '⚠ Stripped "OnDefend" from abilities. Enum value remains (PostgreSQL limitation).'
  );
};
