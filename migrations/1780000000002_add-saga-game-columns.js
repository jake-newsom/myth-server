/**
 * Link games to saga runs for battle tracking (Phase 4)
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.addColumn("games", {
    saga_run_id: {
      type: "uuid",
      notNull: false,
      references: "saga_runs(run_id)",
      onDelete: "SET NULL",
    },
    saga_node_id: {
      type: "varchar(64)",
      notNull: false,
    },
  });

  pgm.createIndex("games", "saga_run_id", {
    name: "idx_games_saga_run_id",
    where: "saga_run_id IS NOT NULL",
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropIndex("games", [], { name: "idx_games_saga_run_id", ifExists: true });
  pgm.dropColumn("games", "saga_node_id", { ifExists: true });
  pgm.dropColumn("games", "saga_run_id", { ifExists: true });
};
