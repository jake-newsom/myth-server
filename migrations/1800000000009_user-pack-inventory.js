/* eslint-disable camelcase */

/**
 * Per-pack inventory: `user_pack_inventory`.
 *
 * ## The gap this fills
 *
 * `users.pack_count` is a single untyped integer. Pack IDENTITY is chosen at
 * open time — the client names a `pack_id` and the server rolls that pack's
 * pool — so a "pack" in a player's inventory is generic: any pack_count can be
 * spent on any released pack.
 *
 * That is fine while every pack is interchangeable, and wrong the moment a pack
 * is a reward in its own right. A Hallow's Eve Pack has to be openable ONLY as
 * a Hallow's Eve Pack; if it credited pack_count, the player could spend it on
 * a standard pack and the event's chase cards would leak into the generic
 * economy in both directions.
 *
 * ## Shape
 *
 * One row per (user, pack) holding a count. Deliberately NOT a row per pack
 * instance: packs are fungible within a type, and a counter avoids writing ten
 * rows to grant ten packs.
 *
 * `quantity >= 0` is enforced by a check constraint rather than left to the
 * application, so an unguarded decrement fails loudly instead of quietly
 * creating negative inventory.
 *
 * ## What this does NOT change
 *
 * `pack_count` keeps its exact current meaning and remains the balance for
 * every standard pack. This table is consulted only for packs that are
 * specifically held — today, event packs. A player's generic packs and their
 * Hallow's Eve packs are separate balances, which is the intent.
 *
 * Additive: a new table with no writes from existing paths. Nothing reads it
 * until the service change ships alongside.
 */

exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.createTable("user_pack_inventory", {
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(user_id)",
      onDelete: "CASCADE",
    },
    pack_id: {
      type: "uuid",
      notNull: true,
      references: "packs(pack_id)",
      onDelete: "CASCADE",
    },
    quantity: { type: "integer", notNull: true, default: 0 },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.addConstraint("user_pack_inventory", "user_pack_inventory_pkey", {
    primaryKey: ["user_id", "pack_id"],
  });

  // Negative inventory is a bug, not a state. Fail the statement rather than
  // let an unguarded decrement persist it.
  pgm.addConstraint(
    "user_pack_inventory",
    "user_pack_inventory_quantity_check",
    { check: "quantity >= 0" }
  );

  // "What does this player hold?" is the read on every shop and inventory
  // screen; the PK already covers it. This one serves the reverse question
  // ("who holds this pack?") for admin and cleanup.
  pgm.createIndex("user_pack_inventory", "pack_id");
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropTable("user_pack_inventory");
};
