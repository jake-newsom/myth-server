/* eslint-disable camelcase */

/**
 * `forge_drafts`: the Forge configuration a player is currently saving up for.
 *
 * The Forge lets a player specify a card (tier → optional character → optional
 * artwork upgrade) whose price can easily exceed what they hold, so the
 * configuration has to outlive the session: they set it, go grind, and come
 * back to the same pending craft. Client-side storage would lose it on a
 * reinstall or a device switch, which is exactly the player who has been
 * saving the longest.
 *
 * One row per user (PK on user_id) — a player is saving toward one card at a
 * time, and replacing the draft is the "change my mind" action. An upsert on
 * the primary key is the only write path.
 *
 * Nothing here is authoritative for pricing: the craft endpoint recomputes the
 * price from FORGE_CONFIG at redemption time. The stored `quoted_price` is a
 * display/telemetry value only, so a later balance change re-prices pending
 * drafts instead of honouring a stale quote.
 *
 * New table, additive: no shipped client reads it, and the Forge tab that
 * writes it is behind the shop overhaul's flag.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable("forge_drafts", {
    user_id: {
      type: "uuid",
      primaryKey: true,
      references: "users(user_id)",
      onDelete: "CASCADE",
    },
    // Base rarity tier: common | rare | epic | legendary. Plain varchar rather
    // than the `rarity` enum, which packs the +/++/+++ upgrade into the same
    // values and would let "rare+" be stored as a tier.
    tier: {
      type: "varchar(16)",
      notNull: true,
    },
    // NULL means "random character within the tier" — the cheaper option, and
    // the default a fresh draft starts in.
    character_id: {
      type: "uuid",
      references: "characters(character_id)",
      onDelete: "SET NULL",
    },
    // "" | "+" | "++" | "+++". Empty string is base artwork, so this is NOT
    // NULL with a '' default: a missing upgrade and base artwork are the same
    // thing, and a nullable column would make every price read coalesce.
    upgrade: {
      type: "varchar(8)",
      notNull: true,
      default: "",
    },
    // What the price was when the draft was last saved. Display only; see the
    // header note about recomputation at craft time.
    quoted_price: {
      type: "integer",
      notNull: true,
      default: 0,
    },
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

  pgm.addConstraint("forge_drafts", "forge_draft_tier_valid", {
    check: "tier IN ('common', 'rare', 'epic', 'legendary')",
  });

  pgm.addConstraint("forge_drafts", "forge_draft_upgrade_valid", {
    check: "upgrade IN ('', '+', '++', '+++')",
  });

  pgm.addConstraint("forge_drafts", "forge_draft_price_non_negative", {
    check: "quoted_price >= 0",
  });
};

exports.down = (pgm) => {
  pgm.dropTable("forge_drafts");
};
