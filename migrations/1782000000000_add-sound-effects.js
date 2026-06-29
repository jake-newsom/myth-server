/**
 * Add a `sound_effect` column to characters, card_variants, and
 * special_abilities.
 *
 *   • characters.sound_effect      – default placement sound for the character
 *   • card_variants.sound_effect   – per-variant override of the placement sound
 *   • special_abilities.sound_effect – sound played when the ability resolves
 *
 * Values are asset filenames/paths the client resolves directly (e.g.
 * "growl.aac"). Card responses expose a single resolved placement sound via
 * COALESCE(card_variants.sound_effect, characters.sound_effect); the ability
 * sound is plumbed onto the events the ability emits.
 *
 * The seed UPDATEs below preserve the behavior previously hardcoded on the
 * client (Fenrir/Bragi/Hel/Thor). They match by character name / ability slug;
 * rows that don't match are simply skipped.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.addColumn("characters", {
    sound_effect: { type: "varchar(255)", notNull: false },
  });
  pgm.addColumn("card_variants", {
    sound_effect: { type: "varchar(255)", notNull: false },
  });
  pgm.addColumn("special_abilities", {
    sound_effect: { type: "varchar(255)", notNull: false },
  });

  // ── Seed: preserve previously-hardcoded client sounds ──────────────────────

  // Fenrir growls on placement. His Devourer's Surge runs every round (not an
  // on-play ability), so the placement sound lives on the character.
  // Character placement sounds (played when the card is put on the board).
  // Hel's sound is a placement sound: her ability (hel_soul) emits no events,
  // and we no longer play sounds on flips — so her sound lives on the character.
  pgm.sql(`
    UPDATE "characters" SET sound_effect = 'growl.aac'    WHERE name = 'Fenrir';
    UPDATE "characters" SET sound_effect = 'hel_flip.aac' WHERE name = 'Hel';
  `);

  // Ability sounds, keyed by ability slug (special_abilities.id). Played when
  // the ability triggers and emits events (Bragi on play, Thor's push,
  // Fenrir's end-of-round Devourer's Surge).
  pgm.sql(`
    UPDATE "special_abilities" SET sound_effect = 'lyre.aac'   WHERE id = 'bragi_inspire';
    UPDATE "special_abilities" SET sound_effect = 'thunder.aac' WHERE id = 'thor_push';
    UPDATE "special_abilities" SET sound_effect = 'growl.aac'   WHERE id = 'fenrir_devourer_surge';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropColumn("special_abilities", "sound_effect");
  pgm.dropColumn("card_variants", "sound_effect");
  pgm.dropColumn("characters", "sound_effect");
};
