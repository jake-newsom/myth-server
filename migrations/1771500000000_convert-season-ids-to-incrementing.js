/**
 * Convert seasonal souls season_id values to incrementing numeric IDs (stored as text).
 * Remaps existing IDs in chronological order and updates all dependent tables.
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  // Drop season_id foreign keys so IDs can be remapped safely.
  pgm.dropConstraint(
    "season_mythology_choices",
    "season_mythology_choices_season_id_fkey",
    { ifExists: true }
  );
  pgm.dropConstraint(
    "season_soul_contributions",
    "season_soul_contributions_season_id_fkey",
    { ifExists: true }
  );
  pgm.dropConstraint(
    "season_mythology_totals",
    "season_mythology_totals_season_id_fkey",
    { ifExists: true }
  );
  pgm.dropConstraint(
    "season_reward_payouts",
    "season_reward_payouts_season_id_fkey",
    { ifExists: true }
  );

  // Build mapping old_id -> new numeric id based on chronological start date.
  pgm.sql(`
    CREATE TEMP TABLE tmp_season_id_map AS
    SELECT
      season_id AS old_id,
      ROW_NUMBER() OVER (ORDER BY start_at ASC, created_at ASC)::text AS new_id
    FROM season_definitions;
  `);

  // Update child tables first (FKs dropped above).
  pgm.sql(`
    UPDATE season_mythology_choices c
    SET season_id = m.new_id
    FROM tmp_season_id_map m
    WHERE c.season_id = m.old_id;
  `);
  pgm.sql(`
    UPDATE season_soul_contributions c
    SET season_id = m.new_id
    FROM tmp_season_id_map m
    WHERE c.season_id = m.old_id;
  `);
  pgm.sql(`
    UPDATE season_mythology_totals t
    SET season_id = m.new_id
    FROM tmp_season_id_map m
    WHERE t.season_id = m.old_id;
  `);
  pgm.sql(`
    UPDATE season_reward_payouts p
    SET season_id = m.new_id
    FROM tmp_season_id_map m
    WHERE p.season_id = m.old_id;
  `);

  // Update primary table IDs last.
  pgm.sql(`
    UPDATE season_definitions s
    SET season_id = m.new_id
    FROM tmp_season_id_map m
    WHERE s.season_id = m.old_id;
  `);

  // Enforce numeric-only season_id syntax going forward.
  pgm.addConstraint(
    "season_definitions",
    "season_definitions_season_id_numeric_only",
    "CHECK (season_id ~ '^[0-9]+$')"
  );

  // Recreate foreign keys.
  pgm.addConstraint(
    "season_mythology_choices",
    "season_mythology_choices_season_id_fkey",
    `FOREIGN KEY (season_id) REFERENCES season_definitions(season_id) ON DELETE CASCADE`
  );
  pgm.addConstraint(
    "season_soul_contributions",
    "season_soul_contributions_season_id_fkey",
    `FOREIGN KEY (season_id) REFERENCES season_definitions(season_id) ON DELETE CASCADE`
  );
  pgm.addConstraint(
    "season_mythology_totals",
    "season_mythology_totals_season_id_fkey",
    `FOREIGN KEY (season_id) REFERENCES season_definitions(season_id) ON DELETE CASCADE`
  );
  pgm.addConstraint(
    "season_reward_payouts",
    "season_reward_payouts_season_id_fkey",
    `FOREIGN KEY (season_id) REFERENCES season_definitions(season_id) ON DELETE CASCADE`
  );
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  // Remove numeric-only guard. ID remapping is intentionally not reverted.
  pgm.dropConstraint(
    "season_definitions",
    "season_definitions_season_id_numeric_only",
    { ifExists: true }
  );
};
