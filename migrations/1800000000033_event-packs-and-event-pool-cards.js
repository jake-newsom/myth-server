/* eslint-disable camelcase */

/**
 * Event packs become a first-class concept, and event cards can ride in
 * standard packs for the duration of their event.
 *
 * `packs.event_id` — non-NULL marks an EVENT PACK. An event pack is opened
 * only from per-pack inventory (`user_pack_inventory`); the generic
 * `pack_count` never pays for it. The shop lists it while its event is live, or
 * to any player still holding some afterwards, so leftovers stay openable.
 *
 * `pack_card_variants.event_id` — non-NULL marks an event card linked into a
 * (standard) pack. The row only resolves while that event is live, so event
 * cards leave standard packs on their own when the event ends; no cleanup job.
 * Such rows are seeded with weight 130 (vs the implicit 100) for the 1.3x
 * in-rarity boost.
 *
 * Additive: both columns nullable, no existing row changes meaning except the
 * Hallow's Eve pack, which is backfilled to its event so it stops being
 * openable from generic pack_count.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns("packs", {
    event_id: {
      type: "uuid",
      notNull: false,
      references: "events(id)",
      onDelete: "SET NULL",
      comment:
        "Non-NULL = event pack: opened only from user_pack_inventory, listed while the event is live or the player holds some.",
    },
  });

  pgm.addColumns("pack_card_variants", {
    event_id: {
      type: "uuid",
      notNull: false,
      references: "events(id)",
      onDelete: "CASCADE",
      comment:
        "Non-NULL = event card in this pack; the row only resolves while the event is live.",
    },
  });

  pgm.createIndex("pack_card_variants", "event_id", {
    where: "event_id IS NOT NULL",
  });

  pgm.sql(`
    UPDATE packs
       SET event_id = (SELECT id FROM events WHERE event_key = 'halloween-2026')
     WHERE slug = 'halloween-2026-pack';
  `);
};

exports.down = (pgm) => {
  pgm.dropColumns("pack_card_variants", ["event_id"]);
  pgm.dropColumns("packs", ["event_id"]);
};
