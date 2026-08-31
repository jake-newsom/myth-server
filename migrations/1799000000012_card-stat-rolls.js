/* eslint-disable camelcase */

/**
 * `user_card_stat_rolls`: per-instance edge-power offsets from the Forge's
 * reforge, as SIGNED deltas against the variant's catalogue `base_power`.
 *
 * Deliberately NOT stored in `user_card_power_ups`, which is the level-up
 * currency: that table's semantics are "one point per level, never negative"
 * (see PowerUpService.applyPowerUp), and `getPowerUpCount` derives the number
 * of level-ups a card has spent by SUMMING its four values. Folding a reforge
 * roll in there would make a +3 roll read as three level-ups already spent —
 * silently costing the player three upgrades — and a negative roll is illegal
 * in that table by construction. The two concepts have to stay separate
 * columns because one is a signed cosmetic-ish reroll and the other is a
 * monotonic count.
 *
 * The roll is SUMMED INTO `base_power` in API responses rather than shipped as
 * a third field. Three places sum a card's power (the engine's
 * updateCurrentPower, its client mirror in card.utils, and GameCard's
 * currentPower), and every one of them reads `base_power + power_enhancements`.
 * Folding the roll into the first term makes all three correct without
 * touching them, and — the reason it matters here — keeps ALREADY-SHIPPED
 * clients correct: an old build sums those same two fields and gets the right
 * number, with no desync between what it renders and what the server plays.
 * There is precedent: sagaService already overrides `base_power` with a
 * buffed per-instance value.
 *
 * The signed offsets are still kept here as the source of truth so the reveal
 * UI can show what was rolled; the summed value is what anything computes with.
 *
 * One row per card instance, written once at craft time. Rows only exist for
 * cards that were actually reforged — absent means an all-zero roll, so no
 * backfill is needed and every pre-existing card keeps its catalogue stats.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable("user_card_stat_rolls", {
    user_card_instance_id: {
      type: "uuid",
      primaryKey: true,
      references: "user_owned_cards(user_card_instance_id)",
      onDelete: "CASCADE",
    },
    // Signed offsets against the variant's base_power, one per edge. The
    // range is enforced below rather than left to application code: these
    // feed combat, so a bad write is a balance incident.
    top: { type: "smallint", notNull: true, default: 0 },
    right: { type: "smallint", notNull: true, default: 0 },
    bottom: { type: "smallint", notNull: true, default: 0 },
    left: { type: "smallint", notNull: true, default: 0 },
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  // -2..+3, matching the reforge distribution in FORGE_CONFIG.REFORGE. A
  // check constraint rather than a trigger: it is a fixed range, and the DB
  // is the last line of defence against a roll that would warp combat maths.
  //
  // `right` and `left` are reserved words in Postgres (the JOIN keywords), so
  // they are quoted here and in every query against this table.
  pgm.addConstraint("user_card_stat_rolls", "card_stat_roll_range_valid", {
    check: `
      "top" BETWEEN -2 AND 3 AND
      "right" BETWEEN -2 AND 3 AND
      "bottom" BETWEEN -2 AND 3 AND
      "left" BETWEEN -2 AND 3
    `,
  });
};

exports.down = (pgm) => {
  pgm.dropTable("user_card_stat_rolls");
};
