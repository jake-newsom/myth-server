// myth-server/src/models/maintenance.model.ts

import db, { QueryExecutor } from "../config/db.config";
import {
  CreateMaintenanceWindowInput,
  MaintenanceWindow,
  UpdateMaintenanceWindowInput,
} from "../types/maintenance.types";

const WINDOW_COLUMNS = `
  maintenance_window_id, message, starts_at, ends_at,
  games_aborted_at, games_aborted_count, created_by, created_at, updated_at
`;

/**
 * Game statuses that mean "this game is still being played". A maintenance
 * sweep moves every one of these to 'aborted'.
 *
 * 'mulligan' belongs here: it was added to the enum separately and is a live
 * pre-combat state, so a game sitting in it is just as mid-match as an 'active'
 * one. Leaving it out would strand exactly the games a cutover must not strand.
 *
 * Note there is no 'cancelled' in this enum -- 'aborted' is the terminal
 * status for a game that ended without a result.
 */
export const IN_FLIGHT_GAME_STATUSES = ["pending", "active", "mulligan"];

function mapWindow(row: any): MaintenanceWindow {
  return {
    maintenance_window_id: row.maintenance_window_id,
    message: row.message,
    starts_at: row.starts_at,
    ends_at: row.ends_at ?? null,
    games_aborted_at: row.games_aborted_at ?? null,
    games_aborted_count: Number(row.games_aborted_count ?? 0),
    created_by: row.created_by ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const MaintenanceModel = {
  /**
   * The window covering this instant, if any.
   *
   * Comparison is done in SQL against current_timestamp rather than against a
   * timestamp computed in Node, so every instance agrees on "now" even when
   * their clocks drift. That matters here more than usual: two servers
   * disagreeing about whether maintenance is open is precisely the split-brain
   * this feature exists to prevent.
   *
   * Overlapping windows are not rejected on write -- the earliest-starting one
   * wins, which keeps the behavior of "schedule a second window by mistake"
   * boring rather than surprising.
   */
  async findActive(
    executor: QueryExecutor = db
  ): Promise<MaintenanceWindow | null> {
    const result = await executor.query(
      `SELECT ${WINDOW_COLUMNS}
         FROM maintenance_windows
        WHERE starts_at <= current_timestamp
          AND (ends_at IS NULL OR ends_at > current_timestamp)
        ORDER BY starts_at ASC
        LIMIT 1`
    );
    return result.rows[0] ? mapWindow(result.rows[0]) : null;
  },

  async findAll(executor: QueryExecutor = db): Promise<MaintenanceWindow[]> {
    const result = await executor.query(
      `SELECT ${WINDOW_COLUMNS}
         FROM maintenance_windows
        ORDER BY starts_at DESC
        LIMIT 100`
    );
    return result.rows.map(mapWindow);
  },

  async findById(
    maintenanceWindowId: string,
    executor: QueryExecutor = db
  ): Promise<MaintenanceWindow | null> {
    const result = await executor.query(
      `SELECT ${WINDOW_COLUMNS}
         FROM maintenance_windows
        WHERE maintenance_window_id = $1`,
      [maintenanceWindowId]
    );
    return result.rows[0] ? mapWindow(result.rows[0]) : null;
  },

  async create(
    input: CreateMaintenanceWindowInput,
    executor: QueryExecutor = db
  ): Promise<MaintenanceWindow> {
    // `message` is omitted from the column list when not supplied so the
    // column DEFAULT applies, rather than restating the default text here and
    // letting the two drift.
    const columns = ["starts_at", "ends_at", "created_by"];
    const values: any[] = [
      input.starts_at ?? null,
      input.ends_at ?? null,
      input.created_by ?? null,
    ];
    // starts_at omitted means "start now".
    const exprs = ["COALESCE($1::timestamptz, current_timestamp)", "$2::timestamptz", "$3"];

    if (input.message !== undefined) {
      columns.push("message");
      values.push(input.message);
      exprs.push(`$${values.length}`);
    }

    const result = await executor.query(
      `INSERT INTO maintenance_windows (${columns.join(", ")})
       VALUES (${exprs.join(", ")})
       RETURNING ${WINDOW_COLUMNS}`,
      values
    );
    return mapWindow(result.rows[0]);
  },

  async update(
    maintenanceWindowId: string,
    input: UpdateMaintenanceWindowInput,
    executor: QueryExecutor = db
  ): Promise<MaintenanceWindow | null> {
    const sets: string[] = [];
    const values: any[] = [];

    if (input.message !== undefined) {
      values.push(input.message);
      sets.push(`message = $${values.length}`);
    }
    if (input.starts_at !== undefined) {
      values.push(input.starts_at);
      sets.push(`starts_at = $${values.length}::timestamptz`);
    }
    // `null` is meaningful here (make the window open-ended), so this checks
    // for `undefined` rather than falsiness.
    if (input.ends_at !== undefined) {
      values.push(input.ends_at);
      sets.push(`ends_at = $${values.length}::timestamptz`);
    }

    if (sets.length === 0) {
      return this.findById(maintenanceWindowId, executor);
    }

    sets.push(`updated_at = current_timestamp`);
    values.push(maintenanceWindowId);

    const result = await executor.query(
      `UPDATE maintenance_windows SET ${sets.join(", ")}
        WHERE maintenance_window_id = $${values.length}
        RETURNING ${WINDOW_COLUMNS}`,
      values
    );
    return result.rows[0] ? mapWindow(result.rows[0]) : null;
  },

  /**
   * End a window now. Used by "maintenance is over, let players back in"
   * without having to guess the right ends_at when scheduling it.
   */
  async endNow(
    maintenanceWindowId: string,
    executor: QueryExecutor = db
  ): Promise<MaintenanceWindow | null> {
    const result = await executor.query(
      `UPDATE maintenance_windows
          SET ends_at = current_timestamp, updated_at = current_timestamp
        WHERE maintenance_window_id = $1
        RETURNING ${WINDOW_COLUMNS}`,
      [maintenanceWindowId]
    );
    return result.rows[0] ? mapWindow(result.rows[0]) : null;
  },

  async delete(
    maintenanceWindowId: string,
    executor: QueryExecutor = db
  ): Promise<boolean> {
    const result = await executor.query(
      `DELETE FROM maintenance_windows WHERE maintenance_window_id = $1`,
      [maintenanceWindowId]
    );
    return (result.rowCount ?? 0) > 0;
  },

  /**
   * Claim the abort sweep for a window, aborting every in-flight game.
   *
   * Runs as a single statement guarded by `games_aborted_at IS NULL`, so if two
   * instances reach an opening window at the same moment exactly one claims it
   * and the other gets `null`. Without that guard both would sweep, and the
   * second would abort games created in the gap between the two sweeps -- which
   * is harmless today but stops being harmless the moment anything reads
   * games_aborted_count.
   *
   * game_results rows CASCADE from games, so rows are updated in place and
   * never deleted; an aborted game keeps its history.
   *
   * Runs in its own transaction so the claim and the sweep commit together:
   * a crash between them would otherwise leave a window marked as swept with
   * games still live, and nothing would ever retry it.
   */
  async claimAndAbortGames(
    maintenanceWindowId: string
  ): Promise<{ claimed: boolean; abortedCount: number }> {
    const client = await db.getClient();
    try {
      await client.query("BEGIN");

      // Claim first, as its own statement. The row is locked for the rest of
      // the transaction, so a second instance arriving concurrently blocks
      // here and then sees games_aborted_at already set -- returning 0 rows
      // and skipping the sweep rather than running it twice.
      const claim = await client.query(
        `UPDATE maintenance_windows
            SET games_aborted_at = current_timestamp,
                updated_at = current_timestamp
          WHERE maintenance_window_id = $1
            AND games_aborted_at IS NULL
          RETURNING maintenance_window_id`,
        [maintenanceWindowId]
      );

      const claimed = (claim.rowCount ?? 0) > 0;
      let abortedCount = 0;

      if (claimed) {
        const aborted = await client.query(
          `UPDATE "games"
              SET game_status = 'aborted',
                  completed_at = COALESCE(completed_at, current_timestamp)
            WHERE game_status = ANY($1::text[]::game_status[])
            RETURNING game_id`,
          [IN_FLIGHT_GAME_STATUSES]
        );
        abortedCount = aborted.rowCount ?? 0;

        await client.query(
          `UPDATE maintenance_windows
              SET games_aborted_count = $2
            WHERE maintenance_window_id = $1`,
          [maintenanceWindowId, abortedCount]
        );
      }

      await client.query("COMMIT");
      return { claimed, abortedCount };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
};

export default MaintenanceModel;
