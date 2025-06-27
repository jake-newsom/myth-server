/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  // Add wonder coins to users table for wonder picks currency
  pgm.addColumn("users", {
    wonder_coins: {
      type: "integer",
      notNull: true,
      default: 0,
    },
  });

  pgm.addConstraint("users", "users_wonder_coins_check", {
    check: "wonder_coins >= 0",
  });

  // Create wonder_picks table for available wonder pick opportunities
  pgm.createTable("wonder_picks", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    pack_opening_id: {
      type: "uuid",
      notNull: true,
      // Note: References pack_opening_history table
    },
    original_owner_id: {
      type: "uuid",
      notNull: true,
      references: "users(user_id)",
      onDelete: "CASCADE",
    },
    original_cards: {
      type: "jsonb",
      notNull: true,
      comment:
        "Array of card objects in original order [card1, card2, card3, card4, card5]",
    },
    set_id: {
      type: "uuid",
      notNull: true,
      references: "sets(set_id)",
      onDelete: "CASCADE",
    },
    cost_wonder_coins: {
      type: "integer",
      notNull: true,
      default: 1,
    },
    max_participants: {
      type: "integer",
      notNull: true,
      default: 10,
    },
    current_participants: {
      type: "integer",
      notNull: true,
      default: 0,
    },
    expires_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("NOW() + INTERVAL '24 hours'"),
    },
    is_active: {
      type: "boolean",
      notNull: true,
      default: true,
    },
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("NOW()"),
    },
    updated_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("NOW()"),
    },
  });

  // Create wonder_pick_participations table for tracking user participations
  pgm.createTable("wonder_pick_participations", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    wonder_pick_id: {
      type: "uuid",
      notNull: true,
      references: "wonder_picks(id)",
      onDelete: "CASCADE",
    },
    participant_id: {
      type: "uuid",
      notNull: true,
      references: "users(user_id)",
      onDelete: "CASCADE",
    },
    shuffled_positions: {
      type: "jsonb",
      notNull: true,
      comment:
        "Array mapping display positions to actual card indices [2, 0, 4, 1, 3]",
    },
    selected_position: {
      type: "integer",
      default: null,
      comment: "Position selected by user (0-4), null if not selected yet",
    },
    won_card: {
      type: "jsonb",
      default: null,
      comment: "Card object won by the user, null if not selected yet",
    },
    cost_paid: {
      type: "integer",
      notNull: true,
      comment: "Wonder coins paid for this participation",
    },
    status: {
      type: "varchar(20)",
      notNull: true,
      default: "shuffled",
      comment: "shuffled, selected, expired",
    },
    participated_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("NOW()"),
    },
    selected_at: {
      type: "timestamp",
      default: null,
    },
    expires_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("NOW() + INTERVAL '30 minutes'"),
      comment: "User has 30 minutes to make selection after shuffling",
    },
  });

  // Add constraints
  pgm.addConstraint("wonder_picks", "wonder_picks_cost_check", {
    check: "cost_wonder_coins > 0",
  });

  pgm.addConstraint("wonder_picks", "wonder_picks_participants_check", {
    check:
      "current_participants >= 0 AND current_participants <= max_participants",
  });

  pgm.addConstraint(
    "wonder_pick_participations",
    "wonder_pick_participations_status_check",
    {
      check: "status IN ('shuffled', 'selected', 'expired')",
    }
  );

  pgm.addConstraint(
    "wonder_pick_participations",
    "wonder_pick_participations_position_check",
    {
      check:
        "selected_position IS NULL OR (selected_position >= 0 AND selected_position <= 4)",
    }
  );

  pgm.addConstraint(
    "wonder_pick_participations",
    "wonder_pick_participations_cost_check",
    {
      check: "cost_paid > 0",
    }
  );

  // Unique constraint: one participation per user per wonder pick
  pgm.createIndex(
    "wonder_pick_participations",
    ["wonder_pick_id", "participant_id"],
    {
      unique: true,
      name: "wonder_pick_participations_unique_per_pick",
    }
  );

  // Indexes for efficient queries
  pgm.createIndex("wonder_picks", "original_owner_id");
  pgm.createIndex("wonder_picks", "set_id");
  pgm.createIndex("wonder_picks", ["is_active", "expires_at"]);
  pgm.createIndex("wonder_picks", "created_at");

  pgm.createIndex("wonder_pick_participations", "wonder_pick_id");
  pgm.createIndex("wonder_pick_participations", "participant_id");
  pgm.createIndex("wonder_pick_participations", ["status", "expires_at"]);

  // Function to auto-update updated_at timestamps
  pgm.sql(`
    CREATE OR REPLACE FUNCTION update_wonder_picks_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Trigger to automatically update updated_at
  pgm.sql(`
    CREATE TRIGGER update_wonder_picks_updated_at_trigger
    BEFORE UPDATE ON wonder_picks
    FOR EACH ROW
    EXECUTE FUNCTION update_wonder_picks_updated_at();
  `);

  // Function to auto-expire wonder picks and participations
  pgm.sql(`
    CREATE OR REPLACE FUNCTION cleanup_expired_wonder_picks()
    RETURNS void AS $$
    BEGIN
      -- Expire participations that haven't been selected in time
      UPDATE wonder_pick_participations 
      SET status = 'expired' 
      WHERE status = 'shuffled' 
        AND expires_at < NOW();
      
      -- Deactivate expired wonder picks
      UPDATE wonder_picks 
      SET is_active = false 
      WHERE is_active = true 
        AND expires_at < NOW();
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Trigger to update participant count when participations are added
  pgm.sql(`
    CREATE OR REPLACE FUNCTION update_wonder_pick_participant_count()
    RETURNS TRIGGER AS $$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        UPDATE wonder_picks 
        SET current_participants = current_participants + 1 
        WHERE id = NEW.wonder_pick_id;
        RETURN NEW;
      ELSIF TG_OP = 'DELETE' THEN
        UPDATE wonder_picks 
        SET current_participants = current_participants - 1 
        WHERE id = OLD.wonder_pick_id;
        RETURN OLD;
      END IF;
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.sql(`
    CREATE TRIGGER update_wonder_pick_participant_count_trigger
    AFTER INSERT OR DELETE ON wonder_pick_participations
    FOR EACH ROW
    EXECUTE FUNCTION update_wonder_pick_participant_count();
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Drop triggers and functions
  pgm.sql(
    "DROP TRIGGER IF EXISTS update_wonder_pick_participant_count_trigger ON wonder_pick_participations;"
  );
  pgm.sql(
    "DROP TRIGGER IF EXISTS update_wonder_picks_updated_at_trigger ON wonder_picks;"
  );
  pgm.sql("DROP FUNCTION IF EXISTS update_wonder_pick_participant_count();");
  pgm.sql("DROP FUNCTION IF EXISTS cleanup_expired_wonder_picks();");
  pgm.sql("DROP FUNCTION IF EXISTS update_wonder_picks_updated_at();");

  // Drop tables
  pgm.dropTable("wonder_pick_participations");
  pgm.dropTable("wonder_picks");

  // Remove wonder coins column
  pgm.dropColumn("users", "wonder_coins");
};
