/**
 * Draft progress for Sagas runs (GDD Section 2)
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.addColumn("saga_runs", {
    draft_state: {
      type: "jsonb",
      notNull: false,
      comment:
        "In-progress draft: phase, picked cards, pick index. Null when draft complete.",
    },
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropColumn("saga_runs", "draft_state", { ifExists: true });
};
