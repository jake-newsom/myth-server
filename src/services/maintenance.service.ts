// myth-server/src/services/maintenance.service.ts

import MaintenanceModel from "../models/maintenance.model";
import logger from "../utils/logger";
import {
  CreateMaintenanceWindowInput,
  MaintenanceStatus,
  MaintenanceWindow,
  UpdateMaintenanceWindowInput,
} from "../types/maintenance.types";

/**
 * How long a resolved maintenance status is trusted before re-reading it.
 *
 * Much shorter than the feature-flag cache (30s). The status is read on every
 * attempt to start a game, so a per-request query isn't ideal -- but the cost
 * of staleness here is letting a game start after the window opened, which is
 * the exact thing this feature exists to prevent. 5s keeps the query rate low
 * while bounding the leak to a handful of games at worst, and those are then
 * caught by the next sweep anyway.
 */
const CACHE_TTL_MS = 5_000;

interface CacheEntry {
  status: MaintenanceStatus;
  expiresAt: number;
}

/** Single global entry -- maintenance is server-wide, not per user. */
let cache: CacheEntry | null = null;

const INACTIVE: MaintenanceStatus = {
  active: false,
  message: null,
  ends_at: null,
  window: null,
};

function invalidate(): void {
  cache = null;
}

const MaintenanceService = {
  /**
   * Is maintenance on right now, and what should the player be told.
   *
   * On the first read of a window that has just opened, this also aborts every
   * in-flight game. Doing it here rather than on a timer means the sweep
   * happens on the first request after the window opens, with no scheduler to
   * register, and it is idempotent: the claim is guarded in SQL so repeated
   * calls and multiple instances produce exactly one sweep.
   *
   * Fails OPEN. If the lookup throws, maintenance reads as off and players keep
   * playing. The opposite posture would turn any database hiccup into a total
   * outage, which is a far worse failure than briefly missing a window -- and
   * an admin watching a deploy will notice a window that didn't take.
   */
  async getStatus(): Promise<MaintenanceStatus> {
    if (cache && cache.expiresAt > Date.now()) {
      return cache.status;
    }

    try {
      const window = await MaintenanceModel.findActive();

      let status: MaintenanceStatus = INACTIVE;
      if (window) {
        if (!window.games_aborted_at) {
          await this.abortInFlightGames(window);
        }
        status = {
          active: true,
          message: window.message,
          ends_at: window.ends_at,
          window,
        };
      }

      cache = { status, expiresAt: Date.now() + CACHE_TTL_MS };
      return status;
    } catch (error) {
      logger.error(
        "Failed to read maintenance status; treating maintenance as OFF",
        undefined,
        error instanceof Error ? error : new Error(String(error))
      );
      return INACTIVE;
    }
  },

  /** Convenience for callers that only need the boolean. */
  async isActive(): Promise<boolean> {
    return (await this.getStatus()).active;
  },

  /**
   * Abort every game still in flight, so nothing survives into the update.
   *
   * Separated from getStatus so it can be invoked directly when scheduling an
   * immediate window, instead of waiting for the next request to trip it.
   */
  async abortInFlightGames(window: MaintenanceWindow): Promise<number> {
    const { claimed, abortedCount } = await MaintenanceModel.claimAndAbortGames(
      window.maintenance_window_id
    );

    if (claimed) {
      logger.info("Maintenance window opened; in-flight games aborted", {
        maintenanceWindowId: window.maintenance_window_id,
        abortedCount,
      });
    }

    return abortedCount;
  },

  // ---- Admin management ------------------------------------------------------

  async listWindows(): Promise<MaintenanceWindow[]> {
    return MaintenanceModel.findAll();
  },

  async getWindow(maintenanceWindowId: string): Promise<MaintenanceWindow | null> {
    return MaintenanceModel.findById(maintenanceWindowId);
  },

  async createWindow(
    input: CreateMaintenanceWindowInput
  ): Promise<MaintenanceWindow> {
    const window = await MaintenanceModel.create(input);
    invalidate();

    // A window that is already open when created should take effect now rather
    // than on whichever request happens to miss the cache first.
    if (new Date(window.starts_at).getTime() <= Date.now()) {
      await this.abortInFlightGames(window);
    }

    logger.info("Maintenance window scheduled", {
      maintenanceWindowId: window.maintenance_window_id,
      startsAt: window.starts_at,
      endsAt: window.ends_at,
    });
    return window;
  },

  async updateWindow(
    maintenanceWindowId: string,
    input: UpdateMaintenanceWindowInput
  ): Promise<MaintenanceWindow | null> {
    const window = await MaintenanceModel.update(maintenanceWindowId, input);
    invalidate();
    return window;
  },

  /** Lift maintenance now. Does NOT restore aborted games -- they are terminal. */
  async endWindow(maintenanceWindowId: string): Promise<MaintenanceWindow | null> {
    const window = await MaintenanceModel.endNow(maintenanceWindowId);
    invalidate();
    if (window) {
      logger.info("Maintenance window ended", { maintenanceWindowId });
    }
    return window;
  },

  async deleteWindow(maintenanceWindowId: string): Promise<boolean> {
    const deleted = await MaintenanceModel.delete(maintenanceWindowId);
    invalidate();
    return deleted;
  },

  /** Drop the cached status. Exposed for tests and for out-of-band DB edits. */
  invalidateCache(): void {
    invalidate();
  },
};

export default MaintenanceService;
