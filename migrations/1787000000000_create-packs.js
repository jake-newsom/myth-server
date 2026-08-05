/**
 * Packs: the purchasable/openable product, decoupled from `sets`.
 *
 * Until now the thing a player opened WAS a set, so pack contents were
 * implicitly "every released variant whose character belongs to set X" --
 * which forced every pack to be a single pantheon. Packs break that: a pack
 * is an explicit, curated list of card_variants that can mix pantheons.
 *
 * `sets` is untouched and stays on `characters`, because set membership still
 * drives passive/ability effects. Pack membership is purely a distribution
 * concern and must never be read by the game engine.
 *
 * Membership is a join table rather than a `pack_id` column on card_variants
 * so a variant can be reprinted in a later pack without losing its original
 * one. `weight` is reserved for per-card pull-rate tuning; NULL means "use the
 * global rarity weights", which is every card today.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.createTable("packs", {
    pack_id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("uuid_generate_v4()"),
    },
    name: { type: "varchar(100)", notNull: true },
    // Stable human-readable handle for seeds/admin tooling and analytics.
    slug: { type: "varchar(100)", notNull: true, unique: true },
    description: { type: "text", notNull: false },
    // Pack art, resolved by the client against /assets/packs/ exactly as set
    // art was.
    image_url: { type: "varchar(255)", notNull: false },
    // Gated exactly like sets.is_released: false hides it from the shop.
    is_released: { type: "boolean", notNull: true, default: false },
    // Scheduled availability. NULL released_at with is_released=true means
    // "available now"; a future date keeps it out of the shop until then.
    released_at: { type: "timestamp", notNull: false },
    // Shop display order; ties broken by name.
    sort_order: { type: "integer", notNull: true, default: 0 },
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
    updated_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  pgm.createIndex("packs", "is_released");
  pgm.createIndex("packs", "sort_order");

  pgm.createTable("pack_card_variants", {
    pack_id: {
      type: "uuid",
      notNull: true,
      references: "packs(pack_id)",
      onDelete: "CASCADE",
    },
    card_variant_id: {
      type: "uuid",
      notNull: true,
      references: "card_variants(card_variant_id)",
      onDelete: "CASCADE",
    },
    // Reserved for per-card pull weighting. NULL = fall back to the global
    // rarity weight table, which is the behaviour for every card today.
    weight: { type: "integer", notNull: false },
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  pgm.addConstraint("pack_card_variants", "pack_card_variants_pkey", {
    primaryKey: ["pack_id", "card_variant_id"],
  });
  // Reverse lookup: "which packs contain this variant?" for admin/collection UI.
  pgm.createIndex("pack_card_variants", "card_variant_id");

  // --- History ---
  // pack_opening_history recorded which SET was opened. Add pack_id and make
  // set_id nullable: old rows keep their set_id and have no pack, new rows
  // record the pack. Nothing backfills set_id, because a mixed pack has no
  // single set -- that is the entire point of this change.
  pgm.addColumn("pack_opening_history", {
    pack_id: {
      type: "uuid",
      notNull: false,
      references: "packs(pack_id)",
      onDelete: "SET NULL",
    },
  });
  pgm.alterColumn("pack_opening_history", "set_id", { notNull: false });
  pgm.createIndex("pack_opening_history", "pack_id");

  // fate_picks snapshots which pool a pick came from, for the "favorite set"
  // stat and for display. Same treatment.
  pgm.addColumn("fate_picks", {
    pack_id: {
      type: "uuid",
      notNull: false,
      references: "packs(pack_id)",
      onDelete: "SET NULL",
    },
  });
  pgm.alterColumn("fate_picks", "set_id", { notNull: false });
  pgm.createIndex("fate_picks", "pack_id");

  // --- Backfill: one pack per released set ---
  // Day one must behave exactly as before, so every currently-released set
  // becomes a pack containing precisely the variants that set's pack opening
  // would have offered (the WHERE clause mirrors PackService.getCardsFromSet).
  // Mixed packs are then authored by editing membership, not by migration.
  pgm.sql(`
    INSERT INTO packs (name, slug, description, image_url, is_released, released_at, sort_order)
    SELECT
      s.name,
      lower(regexp_replace(s.name, '[^a-zA-Z0-9]+', '-', 'g')),
      s.description,
      s.image_url,
      s.is_released,
      CASE WHEN s.is_released THEN s.created_at ELSE NULL END,
      0
    FROM sets s
    WHERE s.is_released = true;
  `);

  pgm.sql(`
    INSERT INTO pack_card_variants (pack_id, card_variant_id)
    SELECT p.pack_id, cv.card_variant_id
    FROM packs p
    JOIN sets s ON s.name = p.name
    JOIN characters ch ON ch.set_id = s.set_id
    JOIN card_variants cv ON cv.character_id = ch.character_id
    WHERE cv.is_exclusive = false
    ON CONFLICT DO NOTHING;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropIndex("fate_picks", "pack_id");
  pgm.dropColumn("fate_picks", "pack_id");
  pgm.dropIndex("pack_opening_history", "pack_id");
  pgm.dropColumn("pack_opening_history", "pack_id");
  // set_id is left nullable on the way down: rows written while packs existed
  // may legitimately have no set, so restoring NOT NULL would fail.
  pgm.dropTable("pack_card_variants");
  pgm.dropTable("packs");
};
