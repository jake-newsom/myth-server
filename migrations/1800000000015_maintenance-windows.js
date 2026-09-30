/**
 * Maintenance windows.
 *
 * A window is a scheduled span during which no new game may start. When a
 * window opens, every game still in a non-terminal status is aborted, so a
 * client that is mid-match stops being able to act on it (its next request
 * 404s) and the server update that follows only ever meets new games.
 *
 * This exists so a breaking gameplay change -- an ability rewrite, an engine
 * change -- can be deployed without any game straddling the cutover. Without
 * it the only options are versioning every changed ability or accepting that
 * an in-flight match resolves half under the old rules and half under the new.
 *
 * Deliberately a table rather than a feature flag: a window has a start and an
 * end, and the whole point is to schedule it ahead of time and have it open and
 * close on its own. Feature flags here are user-scoped booleans with a 30s
 * per-process cache -- wrong shape on both counts, since two players in the
 * same match must never disagree about whether maintenance is on.
 *
 * Purely additive. With no rows present nothing reads as active and every code
 * path behaves exactly as it does today, so deploying this migration on its own
 * is a no-op until someone schedules a window.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.createTable("maintenance_windows", {
    maintenance_window_id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    // Shown to clients that are new enough to render it. Kept short and
    // player-facing ("Servers are updating, back at 3am UTC"), not an
    // internal changelog.
    message: {
      type: "text",
      notNull: true,
      default: "The servers are down for maintenance. Please try again soon.",
    },
    starts_at: { type: "timestamptz", notNull: true },
    // NULL = open-ended: the window stays active until it is ended explicitly.
    // Safer default for an update of unknown length than guessing a duration
    // and having the gate lift while the deploy is still running.
    ends_at: { type: "timestamptz" },
    // Set once, the first time the window is observed to be active and the
    // in-flight games are aborted. Makes that sweep idempotent across
    // instances and restarts -- whoever gets there first claims it.
    games_aborted_at: { type: "timestamptz" },
    // How many games the sweep aborted. Operational record only.
    games_aborted_count: { type: "integer", notNull: true, default: 0 },
    // Who scheduled it. ON DELETE SET NULL: a deleted admin account must not
    // drag the maintenance history with it.
    created_by: {
      type: "uuid",
      references: '"users"',
      onDelete: "SET NULL",
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  // The hot path is "is a window active right now", asked on every attempt to
  // start a game. Ordering by starts_at lets that query walk the index and
  // stop, instead of scanning a table that only grows.
  pgm.createIndex("maintenance_windows", "starts_at");
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropTable("maintenance_windows");
};
