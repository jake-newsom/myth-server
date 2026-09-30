/* eslint-disable camelcase */

/**
 * Lets events award and sell a SPECIFIC pack.
 *
 * `reward_packs` / `item_type = 'pack'` move the generic `users.pack_count`
 * balance, which any released pack can be opened from. An event pack has to
 * stay identified — a Hallow's Eve Pack is only a Hallow's Eve Pack — so it is
 * held in `user_pack_inventory` (1800000000009) and needs a column naming which
 * pack that is.
 *
 * Milestones get a quantity alongside the id: a shop offering already has
 * `grant_amount`, but a milestone's `reward_packs` is the GENERIC count and
 * reusing it would make "1 generic pack and 2 event packs" unexpressible.
 *
 * All columns are nullable / zero-defaulted and no existing row is touched, so
 * every current milestone and offering behaves exactly as before. The
 * `event_pack` item_type is a text column with a CHECK, not an enum, so no
 * separate ALTER TYPE migration is needed here.
 */

exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.addColumns("event_milestones", {
    reward_pack_id: {
      type: "uuid",
      notNull: false,
      references: "packs(pack_id)",
      onDelete: "SET NULL",
      comment:
        "A specific pack held in user_pack_inventory. Distinct from reward_packs, which credits the generic pack_count.",
    },
    reward_pack_quantity: {
      type: "integer",
      notNull: true,
      default: 0,
      comment: "How many of reward_pack_id to grant. Meaningless when that is NULL.",
    },
  });

  pgm.addConstraint(
    "event_milestones",
    "event_milestones_reward_pack_quantity_check",
    { check: "reward_pack_quantity >= 0" }
  );

  pgm.addColumns("event_shop_offerings", {
    grant_pack_id: {
      type: "uuid",
      notNull: false,
      references: "packs(pack_id)",
      onDelete: "SET NULL",
      comment:
        "Set for item_type = 'event_pack': which pack is credited to user_pack_inventory.",
    },
  });

  // `item_type` is free text guarded by a CHECK. Widen it to admit the new
  // value; the existing constraint is dropped and recreated because Postgres
  // has no "extend a CHECK" operation.
  pgm.sql(`
    ALTER TABLE event_shop_offerings
      DROP CONSTRAINT IF EXISTS event_shop_offerings_item_type_check;
  `);
  pgm.sql(`
    ALTER TABLE event_shop_offerings
      ADD CONSTRAINT event_shop_offerings_item_type_check
      CHECK (item_type IN (
        'card', 'pack', 'event_pack', 'border', 'card_back',
        'gems', 'gold', 'fate_coins', 'card_fragments', 'embers'
      ));
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  // Rows using the new value must go before the CHECK narrows again, or the
  // constraint cannot be validated.
  pgm.sql(`DELETE FROM event_shop_offerings WHERE item_type = 'event_pack';`);

  pgm.sql(`
    ALTER TABLE event_shop_offerings
      DROP CONSTRAINT IF EXISTS event_shop_offerings_item_type_check;
  `);
  pgm.sql(`
    ALTER TABLE event_shop_offerings
      ADD CONSTRAINT event_shop_offerings_item_type_check
      CHECK (item_type IN (
        'card', 'pack', 'border', 'card_back',
        'gems', 'gold', 'fate_coins', 'card_fragments', 'embers'
      ));
  `);

  pgm.dropColumns("event_shop_offerings", ["grant_pack_id"]);

  pgm.dropConstraint(
    "event_milestones",
    "event_milestones_reward_pack_quantity_check"
  );
  pgm.dropColumns("event_milestones", [
    "reward_pack_id",
    "reward_pack_quantity",
  ]);
};
