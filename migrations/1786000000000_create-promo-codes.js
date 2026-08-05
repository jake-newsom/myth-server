/**
 * Promo codes.
 *
 * A promo code grants an arbitrary bundle of rewards (gems, packs, fragments,
 * random cards of a given rarity, or specific card variants) to the user who
 * redeems it. Rewards are stored as a jsonb array of RewardItem-shaped entries
 * so the same payload can be handed straight to RewardService.grantRewards.
 *
 * Claim limits:
 *   - max_claims        : total redemptions allowed across all users (NULL = unlimited)
 *   - claim_count       : running total, incremented atomically on redeem
 *   - one row per (promo_code_id, user_id) in promo_code_redemptions enforces
 *     the "one claim per user" rule via a composite primary key.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.createTable("promo_codes", {
    promo_code_id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("uuid_generate_v4()"),
    },
    // Stored uppercased/trimmed; all lookups normalize the same way so codes
    // are effectively case-insensitive.
    code: {
      type: "varchar(64)",
      notNull: true,
      unique: true,
    },
    description: {
      type: "text",
      notNull: false,
    },
    // Array of RewardItem objects, e.g.
    // [{"type":"gems","amount":500},{"type":"random_card","rarity":"rare","count":2}]
    rewards: {
      type: "jsonb",
      notNull: true,
      default: "[]",
    },
    // NULL = unlimited total claims.
    max_claims: {
      type: "integer",
      notNull: false,
    },
    claim_count: {
      type: "integer",
      notNull: true,
      default: 0,
    },
    is_active: {
      type: "boolean",
      notNull: true,
      default: true,
    },
    starts_at: {
      type: "timestamptz",
      notNull: false,
    },
    expires_at: {
      type: "timestamptz",
      notNull: false,
    },
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

  pgm.addConstraint(
    "promo_codes",
    "promo_codes_max_claims_positive",
    "CHECK (max_claims IS NULL OR max_claims > 0)"
  );

  pgm.addConstraint(
    "promo_codes",
    "promo_codes_claim_count_within_max",
    "CHECK (max_claims IS NULL OR claim_count <= max_claims)"
  );

  // Case-insensitive redemption lookups hit this directly. Written as raw SQL
  // because pgm.createIndex emits a plain column index and drops the
  // expression, which would leave `WHERE upper(code) = $1` doing a seq scan.
  pgm.sql(
    `CREATE UNIQUE INDEX promo_codes_code_upper_idx ON promo_codes (upper(code))`
  );

  pgm.createTable("promo_code_redemptions", {
    promo_code_id: {
      type: "uuid",
      notNull: true,
      references: "promo_codes(promo_code_id)",
      onDelete: "CASCADE",
    },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(user_id)",
      onDelete: "CASCADE",
    },
    // Snapshot of what was actually granted, for support/audit.
    granted: {
      type: "jsonb",
      notNull: true,
      default: "[]",
    },
    redeemed_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  // One claim per user per code.
  pgm.addConstraint(
    "promo_code_redemptions",
    "promo_code_redemptions_pkey",
    "PRIMARY KEY (promo_code_id, user_id)"
  );

  pgm.createIndex("promo_code_redemptions", "user_id");
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropTable("promo_code_redemptions");
  pgm.dropTable("promo_codes");
};
