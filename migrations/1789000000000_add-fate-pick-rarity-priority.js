/**
 * Denormalize the fate-pick rarity tier used for browse ordering.
 *
 * `FatePickModel.getAvailableFatePicks` computed `rarity_priority` inline with
 * two `jsonb_array_elements(original_cards)` expansions per candidate row, in a
 * CTE evaluated BEFORE LIMIT/OFFSET. That unpacked JSON for every active pick
 * on every browse request, scaling with the active-pick pool rather than page
 * size.
 *
 * The value is immutable once the pack is opened (original_cards never
 * changes), so it can be computed once at insert time and read as a scalar.
 *
 * Backward-compatible per release rules: the column is nullable with no
 * default, so old server code that doesn't write it keeps inserting fine. The
 * backfill below is idempotent, and the read path uses
 * COALESCE(rarity_priority, <inline expression>) so rows written by an older
 * instance mid-deploy still sort correctly.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.addColumn("fate_picks", {
    rarity_priority: {
      type: "smallint",
      notNull: false,
      comment:
        "Browse sort tier: 0 = has legendary+++, 1 = has any +++, 2 = neither. Denormalized from original_cards at insert.",
    },
  });

  // Backfill existing rows with the same expression the query used inline.
  pgm.sql(`
    UPDATE fate_picks
       SET rarity_priority = CASE
         WHEN EXISTS (
           SELECT 1 FROM jsonb_array_elements(original_cards::jsonb) AS card
            WHERE card->>'rarity' = 'legendary+++'
         ) THEN 0
         WHEN EXISTS (
           SELECT 1 FROM jsonb_array_elements(original_cards::jsonb) AS card
            WHERE card->>'rarity' LIKE '%+++'
         ) THEN 1
         ELSE 2
       END
     WHERE rarity_priority IS NULL;
  `);

  // Supports the browse ordering over the active candidate set.
  pgm.createIndex("fate_picks", ["rarity_priority", "created_at"], {
    name: "fate_picks_browse_order_idx",
    where: "is_active = true",
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropIndex("fate_picks", ["rarity_priority", "created_at"], {
    name: "fate_picks_browse_order_idx",
  });
  pgm.dropColumn("fate_picks", "rarity_priority");
};
