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
  // First drop all constraints and triggers that reference the old table names
  pgm.sql(`
    DROP TRIGGER IF EXISTS update_wonder_pick_participant_count_trigger ON wonder_pick_participations;
    DROP TRIGGER IF EXISTS update_wonder_picks_updated_at_trigger ON wonder_picks;
    DROP FUNCTION IF EXISTS update_wonder_pick_participant_count();
    DROP FUNCTION IF EXISTS cleanup_expired_wonder_picks();
    DROP FUNCTION IF EXISTS update_wonder_picks_updated_at();
  `);

  // Rename wonder_pick_participations table to fate_pick_participations
  pgm.renameTable("wonder_pick_participations", "fate_pick_participations");

  // Rename wonder_picks table to fate_picks
  pgm.renameTable("wonder_picks", "fate_picks");

  // Rename wonder_coins column to fate_coins in users table
  pgm.renameColumn("users", "wonder_coins", "fate_coins");

  // Rename cost_wonder_coins column to cost_fate_coins in fate_picks table
  pgm.renameColumn("fate_picks", "cost_wonder_coins", "cost_fate_coins");

  // Rename wonder_pick_id column to fate_pick_id in fate_pick_participations table
  pgm.renameColumn(
    "fate_pick_participations",
    "wonder_pick_id",
    "fate_pick_id"
  );

  // Recreate constraints with new names
  pgm.addConstraint("users", "users_fate_coins_check", {
    check: "fate_coins >= 0",
  });

  pgm.addConstraint("fate_picks", "fate_picks_cost_check", {
    check: "cost_fate_coins > 0",
  });

  pgm.addConstraint("fate_picks", "fate_picks_participants_check", {
    check: "current_participants <= max_participants",
  });

  pgm.addConstraint(
    "fate_pick_participations",
    "fate_pick_participations_status_check",
    {
      check: "status IN ('pending', 'completed', 'expired')",
    }
  );

  pgm.addConstraint(
    "fate_pick_participations",
    "fate_pick_participations_position_check",
    {
      check: "selected_position BETWEEN 1 AND 5",
    }
  );

  pgm.addConstraint(
    "fate_pick_participations",
    "fate_pick_participations_cost_check",
    {
      check: "cost_paid > 0",
    }
  );

  // Recreate unique constraint with new name
  pgm.addConstraint(
    "fate_pick_participations",
    "fate_pick_participations_unique_per_pick",
    {
      unique: ["fate_pick_id", "participant_id"],
    }
  );

  // Drop old indexes
  pgm.dropIndex("wonder_picks", "original_owner_id");
  pgm.dropIndex("wonder_picks", "set_id");
  pgm.dropIndex("wonder_picks", ["is_active", "expires_at"]);
  pgm.dropIndex("wonder_picks", "created_at");
  pgm.dropIndex("wonder_pick_participations", "wonder_pick_id");
  pgm.dropIndex("wonder_pick_participations", "participant_id");
  pgm.dropIndex("wonder_pick_participations", ["status", "expires_at"]);

  // Recreate indexes with new names
  pgm.createIndex("fate_picks", "original_owner_id");
  pgm.createIndex("fate_picks", "set_id");
  pgm.createIndex("fate_picks", ["is_active", "expires_at"]);
  pgm.createIndex("fate_picks", "created_at");
  pgm.createIndex("fate_pick_participations", "fate_pick_id");
  pgm.createIndex("fate_pick_participations", "participant_id");
  pgm.createIndex("fate_pick_participations", ["status", "expires_at"]);

  // Recreate functions and triggers with new names
  pgm.sql(`
    CREATE OR REPLACE FUNCTION update_fate_picks_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ language 'plpgsql';
  `);

  pgm.sql(`
    CREATE TRIGGER update_fate_picks_updated_at_trigger
    BEFORE UPDATE ON fate_picks
    FOR EACH ROW
    EXECUTE FUNCTION update_fate_picks_updated_at();
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION cleanup_expired_fate_picks()
    RETURNS void AS $$
    BEGIN
      -- Expire pending participations
      UPDATE fate_pick_participations
      SET status = 'expired'
      WHERE status = 'pending' AND expires_at < NOW();
      
      -- Deactivate expired fate picks
      UPDATE fate_picks
      SET is_active = false
      WHERE is_active = true AND expires_at < NOW();
    END;
    $$ language 'plpgsql';
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION update_fate_pick_participant_count()
    RETURNS TRIGGER AS $$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        UPDATE fate_picks
        SET current_participants = current_participants + 1
        WHERE id = NEW.fate_pick_id;
      ELSIF TG_OP = 'DELETE' THEN
        UPDATE fate_picks
        SET current_participants = current_participants - 1
        WHERE id = OLD.fate_pick_id;
      END IF;
      
      RETURN COALESCE(NEW, OLD);
    END;
    $$ language 'plpgsql';
  `);

  pgm.sql(`
    CREATE TRIGGER update_fate_pick_participant_count_trigger
    AFTER INSERT OR DELETE ON fate_pick_participations
    FOR EACH ROW
    EXECUTE FUNCTION update_fate_pick_participant_count();
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Drop new constraints and triggers
  pgm.sql(`
    DROP TRIGGER IF EXISTS update_fate_pick_participant_count_trigger ON fate_pick_participations;
    DROP TRIGGER IF EXISTS update_fate_picks_updated_at_trigger ON fate_picks;
    DROP FUNCTION IF EXISTS update_fate_pick_participant_count();
    DROP FUNCTION IF EXISTS cleanup_expired_fate_picks();
    DROP FUNCTION IF EXISTS update_fate_picks_updated_at();
  `);

  // Rename back to original names
  pgm.renameColumn(
    "fate_pick_participations",
    "fate_pick_id",
    "wonder_pick_id"
  );
  pgm.renameColumn("fate_picks", "cost_fate_coins", "cost_wonder_coins");
  pgm.renameColumn("users", "fate_coins", "wonder_coins");
  pgm.renameTable("fate_picks", "wonder_picks");
  pgm.renameTable("fate_pick_participations", "wonder_pick_participations");

  // Recreate original constraints
  pgm.addConstraint("users", "users_wonder_coins_check", {
    check: "wonder_coins >= 0",
  });

  pgm.addConstraint("wonder_picks", "wonder_picks_cost_check", {
    check: "cost_wonder_coins > 0",
  });

  pgm.addConstraint("wonder_picks", "wonder_picks_participants_check", {
    check: "current_participants <= max_participants",
  });

  pgm.addConstraint(
    "wonder_pick_participations",
    "wonder_pick_participations_status_check",
    {
      check: "status IN ('pending', 'completed', 'expired')",
    }
  );

  pgm.addConstraint(
    "wonder_pick_participations",
    "wonder_pick_participations_position_check",
    {
      check: "selected_position BETWEEN 1 AND 5",
    }
  );

  pgm.addConstraint(
    "wonder_pick_participations",
    "wonder_pick_participations_cost_check",
    {
      check: "cost_paid > 0",
    }
  );

  pgm.addConstraint(
    "wonder_pick_participations",
    "wonder_pick_participations_unique_per_pick",
    {
      unique: ["wonder_pick_id", "participant_id"],
    }
  );

  // Recreate original indexes
  pgm.createIndex("wonder_picks", "original_owner_id");
  pgm.createIndex("wonder_picks", "set_id");
  pgm.createIndex("wonder_picks", ["is_active", "expires_at"]);
  pgm.createIndex("wonder_picks", "created_at");
  pgm.createIndex("wonder_pick_participations", "wonder_pick_id");
  pgm.createIndex("wonder_pick_participations", "participant_id");
  pgm.createIndex("wonder_pick_participations", ["status", "expires_at"]);

  // Recreate original functions
  pgm.sql(`
    CREATE OR REPLACE FUNCTION update_wonder_picks_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ language 'plpgsql';
  `);

  pgm.sql(`
    CREATE TRIGGER update_wonder_picks_updated_at_trigger
    BEFORE UPDATE ON wonder_picks
    FOR EACH ROW
    EXECUTE FUNCTION update_wonder_picks_updated_at();
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION cleanup_expired_wonder_picks()
    RETURNS void AS $$
    BEGIN
      UPDATE wonder_pick_participations
      SET status = 'expired'
      WHERE status = 'pending' AND expires_at < NOW();
      
      UPDATE wonder_picks
      SET is_active = false
      WHERE is_active = true AND expires_at < NOW();
    END;
    $$ language 'plpgsql';
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION update_wonder_pick_participant_count()
    RETURNS TRIGGER AS $$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        UPDATE wonder_picks
        SET current_participants = current_participants + 1
        WHERE id = NEW.wonder_pick_id;
      ELSIF TG_OP = 'DELETE' THEN
        UPDATE wonder_picks
        SET current_participants = current_participants - 1
        WHERE id = OLD.wonder_pick_id;
      END IF;
      RETURN COALESCE(NEW, OLD);
    END;
    $$ language 'plpgsql';
  `);

  pgm.sql(`
    CREATE TRIGGER update_wonder_pick_participant_count_trigger
    AFTER INSERT OR DELETE ON wonder_pick_participations
    FOR EACH ROW
    EXECUTE FUNCTION update_wonder_pick_participant_count();
  `);
};
