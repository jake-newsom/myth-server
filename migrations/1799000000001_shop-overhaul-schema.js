/* eslint-disable camelcase */

/**
 * Schema for the shop overhaul: a tab column on offerings, and a per-tab
 * paid-reset counter.
 *
 * ## `daily_shop_offerings.shop_tab`
 *
 * The shop is becoming multi-tab (daily / soul / saga / vault). The Soul Shop
 * is a large, exhaustive catalogue of common+rare cards priced in fragments —
 * hundreds of rows per day — and it must NOT be mixed into the flat
 * `offerings[]` array that shipped clients render. A column lets one table
 * serve both tabs while the legacy read path filters to `'daily'`.
 *
 * Defaulted to `'daily'` and NOT NULL, so every existing row keeps exactly the
 * meaning it has today and the legacy filter is a no-op against them.
 *
 * A plain varchar, not an enum: tabs are a presentation grouping we expect to
 * add to (a "vault" tab is already planned), and adding an enum value requires
 * its own out-of-transaction migration each time.
 *
 * ## `shop_tab_resets`
 *
 * Players can pay gems to reroll a tab's contents: 50, then 100, 200, 400 …
 * doubling with each reset, and the counter clears at that tab's own server
 * reset. Storing the count per (user, tab, period_key) makes the price a pure
 * function of a single integer and makes the "resets until server reset" rule
 * fall out of the key: `period_key` is the shop date for daily tabs and the
 * ISO week for the saga tab, so a new period simply has no row yet.
 *
 * We deliberately do NOT reuse `daily_shop_purchases.resets_used`. That column
 * is per-item_type and is written on purchase; tab resets are a separate action
 * that can happen with no purchase at all, and conflating them would make the
 * existing per-item limit reset (which stays as-is) unreadable.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns("daily_shop_offerings", {
    shop_tab: {
      type: "varchar(32)",
      notNull: true,
      default: "daily",
    },
  });

  // The hot read is "today's offerings for one tab".
  pgm.createIndex("daily_shop_offerings", ["shop_date", "shop_tab"]);

  pgm.createTable("shop_tab_resets", {
    reset_id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("uuid_generate_v4()"),
    },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(user_id)",
      onDelete: "CASCADE",
    },
    shop_tab: {
      type: "varchar(32)",
      notNull: true,
    },
    // Shop date (YYYY-MM-DD) for daily tabs, ISO week (YYYY-Www) for weekly.
    // Kept as text rather than a date so both shapes fit one column.
    period_key: {
      type: "varchar(16)",
      notNull: true,
    },
    resets_used: {
      type: "integer",
      notNull: true,
      default: 0,
    },
    gems_spent: {
      type: "integer",
      notNull: true,
      default: 0,
    },
    updated_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  // One counter per user per tab per period — the upsert target.
  pgm.addConstraint("shop_tab_resets", "unique_user_tab_period", {
    unique: ["user_id", "shop_tab", "period_key"],
  });

  pgm.addConstraint("shop_tab_resets", "resets_used_non_negative", {
    check: "resets_used >= 0",
  });
};

exports.down = (pgm) => {
  pgm.dropTable("shop_tab_resets");
  pgm.dropIndex("daily_shop_offerings", ["shop_date", "shop_tab"]);
  pgm.dropColumns("daily_shop_offerings", ["shop_tab"]);
};
