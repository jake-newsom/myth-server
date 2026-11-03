/* eslint-disable camelcase */

/**
 * First edition: the first 50 player-minted copies of each card variant (each
 * art, not each character) carry a "1st Edition" badge.
 *
 * - user_owned_cards.print_number: nullable. NULL means un-numbered (AI decks,
 *   tower AI copies, starter decks, and every row minted before the backfill).
 *   Assigned once at mint time by utils/printNumber.ts and never reused, so a
 *   sacrificed first edition is gone for good.
 * - variant_print_counters: one row per variant, bumped atomically under the
 *   row lock inside the grant transaction.
 *
 * Additive only. Existing rows are numbered by scripts/backfill-print-numbers.ts,
 * run separately after deploy.
 */

exports.up = (pgm) => {
  pgm.addColumn("user_owned_cards", {
    print_number: { type: "integer", notNull: false },
  });

  pgm.createTable("variant_print_counters", {
    card_variant_id: {
      type: "uuid",
      primaryKey: true,
      references: "card_variants(card_variant_id)",
      onDelete: "CASCADE",
    },
    minted: { type: "integer", notNull: true, default: 0 },
  });
};

exports.down = (pgm) => {
  pgm.dropTable("variant_print_counters");
  pgm.dropColumn("user_owned_cards", "print_number");
};
