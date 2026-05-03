/**
 * Card borders system.
 *
 * Adds:
 * - card_borders catalog (admin-managed)
 * - user_owned_borders ownership table (own once, equip anywhere)
 * - user_owned_cards.equipped_border_id (per-instance equipped border)
 * - reward_border_id columns on existing reward source tables (mail, achievements,
 *   monthly_login_config) so future reward flows can grant borders without further
 *   schema changes.
 *
 * Borders may optionally be restricted to a specific character_id and/or set_id;
 * when both are null the border is unrestricted. Restriction enforcement happens
 * server-side at equip time.
 */

exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.createTable("card_borders", {
    border_id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("uuid_generate_v4()"),
    },
    name: { type: "varchar(100)", notNull: true },
    description: { type: "text", notNull: false },
    image_url: { type: "varchar(255)", notNull: true },
    animation_key: { type: "varchar(100)", notNull: false },
    character_id: {
      type: "uuid",
      notNull: false,
      references: "characters(character_id)",
      onDelete: "SET NULL",
    },
    set_id: {
      type: "uuid",
      notNull: false,
      references: "sets(set_id)",
      onDelete: "SET NULL",
    },
    is_active: { type: "boolean", notNull: true, default: true },
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

  pgm.createIndex("card_borders", "character_id", {
    name: "card_borders_character_id_active_idx",
    where: "character_id IS NOT NULL AND is_active = true",
  });
  pgm.createIndex("card_borders", "set_id", {
    name: "card_borders_set_id_active_idx",
    where: "set_id IS NOT NULL AND is_active = true",
  });
  pgm.createIndex("card_borders", "is_active", {
    name: "card_borders_is_active_idx",
    where: "is_active = true",
  });

  pgm.createTable("user_owned_borders", {
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(user_id)",
      onDelete: "CASCADE",
    },
    border_id: {
      type: "uuid",
      notNull: true,
      references: "card_borders(border_id)",
      onDelete: "CASCADE",
    },
    acquired_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });
  pgm.addConstraint("user_owned_borders", "user_owned_borders_pkey", {
    primaryKey: ["user_id", "border_id"],
  });

  pgm.addColumn("user_owned_cards", {
    equipped_border_id: {
      type: "uuid",
      notNull: false,
      references: "card_borders(border_id)",
      onDelete: "SET NULL",
    },
  });

  // Partial indexes accelerate the two bulk paths (equip-all and unequip-all).
  // We deliberately avoid a full index on equipped_border_id - we have no need
  // for "all users equipping border X" lookups.
  pgm.createIndex("user_owned_cards", "user_id", {
    name: "user_owned_cards_user_id_no_border_idx",
    where: "equipped_border_id IS NULL",
  });
  pgm.createIndex("user_owned_cards", "user_id", {
    name: "user_owned_cards_user_id_has_border_idx",
    where: "equipped_border_id IS NOT NULL",
  });

  pgm.addColumn("mail", {
    reward_border_id: {
      type: "uuid",
      notNull: false,
      references: "card_borders(border_id)",
      onDelete: "SET NULL",
    },
  });

  pgm.addColumn("achievements", {
    reward_border_id: {
      type: "uuid",
      notNull: false,
      references: "card_borders(border_id)",
      onDelete: "SET NULL",
    },
  });

  pgm.addColumn("monthly_login_config", {
    reward_border_id: {
      type: "uuid",
      notNull: false,
      references: "card_borders(border_id)",
      onDelete: "SET NULL",
    },
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropColumn("monthly_login_config", "reward_border_id");
  pgm.dropColumn("achievements", "reward_border_id");
  pgm.dropColumn("mail", "reward_border_id");

  pgm.dropIndex("user_owned_cards", "user_id", {
    name: "user_owned_cards_user_id_has_border_idx",
    ifExists: true,
  });
  pgm.dropIndex("user_owned_cards", "user_id", {
    name: "user_owned_cards_user_id_no_border_idx",
    ifExists: true,
  });
  pgm.dropColumn("user_owned_cards", "equipped_border_id");

  pgm.dropTable("user_owned_borders");
  pgm.dropTable("card_borders");
};
