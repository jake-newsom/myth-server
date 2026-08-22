/* eslint-disable camelcase */

/**
 * Cosmetic variant choices for drafted cards.
 *
 * The draft pool is original printings only, so `player1_picks` / `player2_picks`
 * hold canonical character identity — that is what bans, the "already taken"
 * rule and dedup all key off, and it must stay that way.
 *
 * A player may still play an owned +/++/+++ skin of a card they drafted. That
 * preference is stored SEPARATELY here (original_variant_id -> chosen_variant_id)
 * rather than by rewriting the pick, so the canonical identity is never lost
 * and a bogus or unowned choice can always fall back to the original.
 *
 * Purely cosmetic: drafted cards are level 1 with no power-ups, and power comes
 * from the character, so a skin can never confer an advantage.
 *
 * Release-safety: nullable column with a safe default, on a table nothing but
 * the ranked draft reads.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn("ranked_draft_sessions", {
    player1_variants: { type: "jsonb", notNull: true, default: "{}" },
    player2_variants: { type: "jsonb", notNull: true, default: "{}" },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("ranked_draft_sessions", ["player1_variants", "player2_variants"]);
};
