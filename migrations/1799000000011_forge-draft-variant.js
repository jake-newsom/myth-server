/* eslint-disable camelcase */

/**
 * `forge_drafts.card_variant_id`: the EXACT artwork the player chose.
 *
 * The draft previously identified artwork as `upgrade` ("" | "+" | "++" |
 * "+++"), which assumed one variant per (character, rarity). That is not true
 * of the catalogue: 40 (character, rarity) pairs have more than one art, up to
 * 4 on one pair. Under the old model the picker collapsed them to a single
 * tile and `resolveVariant` picked between them with an unordered `LIMIT 1`,
 * so a player choosing "Baldr epic+" could be minted either baldr-1 or
 * baldr-2 arbitrarily.
 *
 * Nullable and additive:
 *   - NULL keeps the old meaning exactly — "any art at this upgrade level" —
 *     which is what a random-character draft means and what every row written
 *     by a shipped client contains. No backfill: NULL is already correct for
 *     them, and the craft path still resolves by (character, rarity) when it
 *     is absent.
 *   - `upgrade` is deliberately NOT dropped. It still prices the craft (the
 *     multiplier is per upgrade level), it is what a random-character draft
 *     selects on, and old clients still write it. The new column narrows the
 *     choice within a level; it does not replace it.
 *
 * ON DELETE SET NULL rather than CASCADE: retiring an artwork should degrade a
 * pending draft to "any art at this level", not silently delete the draft a
 * player has been saving toward.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn("forge_drafts", {
    card_variant_id: {
      type: "uuid",
      notNull: false,
      references: "card_variants(card_variant_id)",
      onDelete: "SET NULL",
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("forge_drafts", "card_variant_id");
};
