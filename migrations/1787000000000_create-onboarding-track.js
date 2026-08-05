/* eslint-disable camelcase */

/**
 * Launch onboarding reward track.
 *
 * Two tables:
 *   - user_onboarding_progress: the day counter. `current_day` is the Nth
 *     DISTINCT UTC day the player made an authenticated request (day 1 =
 *     signup day). `last_tick_date` is the cheap short-circuit that keeps the
 *     per-request tick from writing more than once per UTC day.
 *   - user_onboarding_grants: the idempotency ledger. UNIQUE(user_id,
 *     milestone_day) is the sole concurrency guard preventing duplicate
 *     milestone mail, since the tick fires on every authenticated request.
 *
 * Also adds mail.reward_card_back_id so card backs have a mail delivery
 * channel (mirrors the existing reward_border_id precedent).
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable("user_onboarding_progress", {
    user_id: {
      type: "uuid",
      primaryKey: true,
      references: "users(user_id)",
      onDelete: "CASCADE",
    },
    // Nth distinct UTC login day. Only ever increments; never resets.
    current_day: {
      type: "integer",
      notNull: true,
      default: 1,
    },
    // UTC date on which current_day was last incremented.
    last_tick_date: {
      type: "date",
      notNull: true,
    },
    // Set once the final milestone has been dispatched; lets the tick stop.
    completed_at: {
      type: "timestamptz",
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

  pgm.createTable("user_onboarding_grants", {
    grant_id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(user_id)",
      onDelete: "CASCADE",
    },
    milestone_day: {
      type: "integer",
      notNull: true,
    },
    mail_id: {
      type: "uuid",
      references: "mail(id)",
      onDelete: "SET NULL",
    },
    granted_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("CURRENT_TIMESTAMP"),
    },
  });

  // THE concurrency guard. Every milestone send is an
  // INSERT ... ON CONFLICT DO NOTHING RETURNING against this constraint, so
  // duplicate mail is structurally impossible even under concurrent requests.
  pgm.addConstraint(
    "user_onboarding_grants",
    "user_onboarding_grants_unique_day",
    {
      unique: ["user_id", "milestone_day"],
    }
  );

  pgm.createIndex("user_onboarding_grants", ["user_id"], {
    name: "idx_user_onboarding_grants_user",
  });

  // Card backs previously had no way to be attached to mail. Nullable FK
  // mirroring reward_border_id.
  pgm.addColumn("mail", {
    reward_card_back_id: {
      type: "uuid",
      references: "card_backs(back_id)",
      onDelete: "SET NULL",
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("mail", "reward_card_back_id");
  pgm.dropTable("user_onboarding_grants");
  pgm.dropTable("user_onboarding_progress");
};
