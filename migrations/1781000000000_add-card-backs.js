/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable("card_backs", {
    back_id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    code_key: {
      type: "text",
      notNull: true,
      unique: true,
    },
    name: {
      type: "text",
      notNull: true,
    },
    description: {
      type: "text",
    },
    image_url: {
      type: "text",
      notNull: true,
    },
    animation_key: {
      type: "text",
    },
    is_active: {
      type: "boolean",
      notNull: true,
      default: true,
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("CURRENT_TIMESTAMP"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("CURRENT_TIMESTAMP"),
    },
  });

  pgm.createTable("user_owned_card_backs", {
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(user_id)",
      onDelete: "CASCADE",
    },
    back_id: {
      type: "uuid",
      notNull: true,
      references: "card_backs(back_id)",
      onDelete: "CASCADE",
    },
    acquired_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("CURRENT_TIMESTAMP"),
    },
  });
  pgm.addConstraint("user_owned_card_backs", "user_owned_card_backs_pk", {
    primaryKey: ["user_id", "back_id"],
  });

  pgm.addColumn("decks", {
    equipped_card_back_id: {
      type: "uuid",
      references: "card_backs(back_id)",
      onDelete: "SET NULL",
    },
  });

  pgm.createIndex("card_backs", ["is_active", "name"], {
    name: "idx_card_backs_active_name",
  });
  pgm.createIndex("user_owned_card_backs", ["user_id"], {
    name: "idx_user_owned_card_backs_user",
  });
  pgm.createIndex("decks", ["equipped_card_back_id"], {
    name: "idx_decks_equipped_card_back_id",
  });
};

exports.down = (pgm) => {
  pgm.dropIndex("decks", ["equipped_card_back_id"], {
    name: "idx_decks_equipped_card_back_id",
  });
  pgm.dropIndex("user_owned_card_backs", ["user_id"], {
    name: "idx_user_owned_card_backs_user",
  });
  pgm.dropIndex("card_backs", ["is_active", "name"], {
    name: "idx_card_backs_active_name",
  });
  pgm.dropColumn("decks", "equipped_card_back_id");
  pgm.dropTable("user_owned_card_backs");
  pgm.dropTable("card_backs");
};
