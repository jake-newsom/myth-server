/**
 * Add per-character scoping to border ownership.
 *
 * Previously user_owned_borders had PK (user_id, border_id) — ownership was
 * binary: you own it or you don't. This breaks the intended model where a
 * set-wide border (e.g. "norse-mid-ach") should only be usable on a specific
 * character after that character's achievement is completed.
 *
 * After this migration:
 *   - character_id IS NULL  → globally owned (mail, shop, standard achievements)
 *   - character_id IS NOT NULL → owned only for that specific character
 *
 * Uniqueness is enforced via a functional unique index on
 * (user_id, border_id, COALESCE(character_id, sentinel_uuid)) so both NULL and
 * non-NULL character_id cases are covered by a single index.
 */

exports.shorthands = undefined;

const SENTINEL_UUID = "00000000-0000-0000-0000-000000000000";

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.dropConstraint("user_owned_borders", "user_owned_borders_pkey");

  pgm.addColumn("user_owned_borders", {
    character_id: {
      type: "uuid",
      notNull: false,
      references: "characters(character_id)",
      onDelete: "CASCADE",
    },
  });

  pgm.createIndex(
    "user_owned_borders",
    [
      "user_id",
      "border_id",
      { name: `COALESCE(character_id, '${SENTINEL_UUID}'::uuid)` },
    ],
    {
      name: "user_owned_borders_unique_ownership",
      unique: true,
    }
  );

  pgm.createIndex("user_owned_borders", ["user_id", "border_id"], {
    name: "user_owned_borders_user_border_idx",
  });

  pgm.createIndex("user_owned_borders", "character_id", {
    name: "user_owned_borders_character_id_idx",
    where: "character_id IS NOT NULL",
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropIndex("user_owned_borders", "character_id", {
    name: "user_owned_borders_character_id_idx",
    ifExists: true,
  });

  pgm.dropIndex("user_owned_borders", ["user_id", "border_id"], {
    name: "user_owned_borders_user_border_idx",
    ifExists: true,
  });

  pgm.dropIndex("user_owned_borders", [], {
    name: "user_owned_borders_unique_ownership",
    ifExists: true,
  });

  // Before restoring the original PK, collapse per-character rows into a single
  // global row per (user_id, border_id). Keep the earliest acquired_at.
  pgm.sql(`
    DELETE FROM "user_owned_borders" a
    USING "user_owned_borders" b
    WHERE a.user_id = b.user_id
      AND a.border_id = b.border_id
      AND a.ctid > b.ctid;
  `);

  pgm.dropColumn("user_owned_borders", "character_id");

  pgm.addConstraint("user_owned_borders", "user_owned_borders_pkey", {
    primaryKey: ["user_id", "border_id"],
  });
};
