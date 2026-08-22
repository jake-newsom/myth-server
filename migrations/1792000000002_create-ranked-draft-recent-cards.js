/* eslint-disable camelcase */

/**
 * The 20 most recently drafted cards per user, for Ranked Draft.
 *
 * The draft library is the whole catalog, which is far too large to scan under
 * a 20-second pick clock. Surfacing what a player actually drafts is the
 * difference between a usable draft and a frantic one, so these ids are sorted
 * to the front of the pick grid regardless of the chosen sort.
 *
 * A table rather than a jsonb column on `users`:
 *   - the 20-cap is a plain DELETE, not a read-modify-write
 *   - two drafts finishing at once cannot clobber each other's list
 *   - it is indexable, and it does not widen a hot row that is read everywhere
 *
 * Written once at draft COMPLETION (inside the same transaction that creates
 * the game), never per-pick, so an abandoned draft leaves no trace.
 *
 * Release-safety: new table, unread and unwritten until the flag is on.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable("user_ranked_draft_recent_cards", {
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(user_id)",
      onDelete: "CASCADE",
    },
    card_variant_id: {
      type: "uuid",
      notNull: true,
      references: "card_variants(card_variant_id)",
      onDelete: "CASCADE",
    },
    used_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  // Re-drafting a card updates its recency rather than inserting a duplicate.
  pgm.addConstraint("user_ranked_draft_recent_cards", "user_ranked_draft_recent_cards_pkey", {
    primaryKey: ["user_id", "card_variant_id"],
  });

  // Covers both the per-user read and the trim-to-20 ordering.
  pgm.createIndex("user_ranked_draft_recent_cards", ["user_id", "used_at"], {
    name: "user_ranked_draft_recent_cards_user_recency_idx",
  });
};

exports.down = (pgm) => {
  pgm.dropTable("user_ranked_draft_recent_cards");
};
