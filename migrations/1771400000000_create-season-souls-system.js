/**
 * Create database-backed seasonal souls competition tables.
 * Seasons are configured in DB with explicit start/end windows.
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.createTable("season_definitions", {
    season_id: {
      type: "text",
      primaryKey: true,
    },
    name: {
      type: "text",
      notNull: true,
    },
    start_at: {
      type: "timestamptz",
      notNull: true,
    },
    end_at: {
      type: "timestamptz",
      notNull: true,
    },
    status: {
      type: "text",
      notNull: true,
      default: "scheduled",
    },
    generated_by: {
      type: "text",
      notNull: true,
      default: "system",
    },
    generation_rule_version: {
      type: "integer",
      notNull: true,
      default: 1,
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
  });

  pgm.addConstraint(
    "season_definitions",
    "season_definitions_start_before_end",
    "CHECK (start_at < end_at)"
  );
  pgm.addConstraint(
    "season_definitions",
    "season_definitions_status_check",
    "CHECK (status IN ('scheduled', 'active', 'finalizing', 'finalized', 'cancelled'))"
  );

  pgm.createIndex("season_definitions", ["start_at", "end_at"], {
    name: "idx_season_definitions_window",
  });
  pgm.createIndex("season_definitions", ["status", "start_at"], {
    name: "idx_season_definitions_status_start",
  });

  pgm.createTable("season_mythology_choices", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    user_id: {
      type: "uuid",
      notNull: true,
      references: '"users"',
      onDelete: "CASCADE",
    },
    season_id: {
      type: "text",
      notNull: true,
      references: "season_definitions(season_id)",
      onDelete: "CASCADE",
    },
    set_id: {
      type: "uuid",
      notNull: true,
      references: '"sets"',
      onDelete: "RESTRICT",
    },
    locked_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
  });

  pgm.addConstraint(
    "season_mythology_choices",
    "season_mythology_choices_unique_user_season",
    "UNIQUE (user_id, season_id)"
  );
  pgm.createIndex("season_mythology_choices", ["season_id", "set_id"], {
    name: "idx_season_choice_season_set",
  });

  pgm.createTable("season_soul_contributions", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    season_id: {
      type: "text",
      notNull: true,
      references: "season_definitions(season_id)",
      onDelete: "CASCADE",
    },
    user_id: {
      type: "uuid",
      notNull: true,
      references: '"users"',
      onDelete: "CASCADE",
    },
    set_id: {
      type: "uuid",
      notNull: true,
      references: '"sets"',
      onDelete: "RESTRICT",
    },
    souls_total: {
      type: "bigint",
      notNull: true,
      default: 0,
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
  });

  pgm.addConstraint(
    "season_soul_contributions",
    "season_soul_contributions_unique",
    "UNIQUE (season_id, user_id, set_id)"
  );
  pgm.createIndex("season_soul_contributions", ["season_id", "set_id", "souls_total"], {
    name: "idx_season_contrib_season_set_souls",
  });
  pgm.createIndex("season_soul_contributions", ["season_id", "user_id"], {
    name: "idx_season_contrib_season_user",
  });

  pgm.createTable("season_mythology_totals", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    season_id: {
      type: "text",
      notNull: true,
      references: "season_definitions(season_id)",
      onDelete: "CASCADE",
    },
    set_id: {
      type: "uuid",
      notNull: true,
      references: '"sets"',
      onDelete: "RESTRICT",
    },
    souls_total: {
      type: "bigint",
      notNull: true,
      default: 0,
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
  });

  pgm.addConstraint(
    "season_mythology_totals",
    "season_mythology_totals_unique",
    "UNIQUE (season_id, set_id)"
  );
  pgm.createIndex("season_mythology_totals", ["season_id", "souls_total"], {
    name: "idx_season_totals_season_souls",
  });

  pgm.createTable("season_reward_payouts", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    season_id: {
      type: "text",
      notNull: true,
      references: "season_definitions(season_id)",
      onDelete: "CASCADE",
    },
    user_id: {
      type: "uuid",
      notNull: true,
      references: '"users"',
      onDelete: "CASCADE",
    },
    status: {
      type: "text",
      notNull: true,
      default: "pending",
    },
    bundle_json: {
      type: "jsonb",
      notNull: true,
      default: "{}",
    },
    payout_hash: {
      type: "text",
    },
    mail_id: {
      type: "uuid",
      references: "mail(id)",
      onDelete: "SET NULL",
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
  });

  pgm.addConstraint(
    "season_reward_payouts",
    "season_reward_payouts_status_check",
    "CHECK (status IN ('pending', 'sent', 'claimed', 'failed'))"
  );
  pgm.addConstraint(
    "season_reward_payouts",
    "season_reward_payouts_unique_user_season",
    "UNIQUE (season_id, user_id)"
  );
  pgm.createIndex("season_reward_payouts", ["season_id", "status"], {
    name: "idx_season_payouts_season_status",
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropTable("season_reward_payouts");
  pgm.dropTable("season_mythology_totals");
  pgm.dropTable("season_soul_contributions");
  pgm.dropTable("season_mythology_choices");
  pgm.dropTable("season_definitions");
};
