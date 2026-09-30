// myth-server/src/api/controllers/maintenance.controller.ts

import { Response } from "express";
import { AuthenticatedRequest } from "../../types";
import MaintenanceService from "../../services/maintenance.service";
import logger from "../../utils/logger";

/** Rejects a value that isn't a parseable date. */
function parseDate(value: unknown, field: string): { error?: string } {
  if (value === undefined || value === null) return {};
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    return { error: `${field} must be an ISO 8601 date string` };
  }
  return {};
}

const MaintenanceController = {
  // ---- Public ---------------------------------------------------------------

  /**
   * Current maintenance state. Unauthenticated on purpose: a client needs to
   * ask this while it is being refused everywhere else, and there is nothing
   * sensitive in the answer.
   */
  async getStatus(_req: AuthenticatedRequest, res: Response) {
    try {
      const status = await MaintenanceService.getStatus();
      return res.status(200).json({
        data: {
          active: status.active,
          message: status.message,
          ends_at: status.ends_at,
        },
      });
    } catch (error) {
      logger.error(
        "Error reading maintenance status",
        undefined,
        error instanceof Error ? error : new Error(String(error))
      );
      // Mirrors the service's fail-open posture: a broken status read must not
      // convince a healthy client that it is locked out.
      return res
        .status(200)
        .json({ data: { active: false, message: null, ends_at: null } });
    }
  },

  // ---- Admin ----------------------------------------------------------------

  async listWindows(_req: AuthenticatedRequest, res: Response) {
    try {
      const windows = await MaintenanceService.listWindows();
      return res.status(200).json({ data: windows });
    } catch (error) {
      logger.error(
        "Error listing maintenance windows",
        undefined,
        error instanceof Error ? error : new Error(String(error))
      );
      return res
        .status(500)
        .json({ message: "Failed to list maintenance windows" });
    }
  },

  /**
   * Schedule a window. Omit `starts_at` to begin immediately, which also
   * aborts every in-flight game before responding -- so a 201 here means the
   * server is already drained.
   */
  async createWindow(req: AuthenticatedRequest, res: Response) {
    try {
      const { message, starts_at, ends_at } = req.body ?? {};

      const startErr = parseDate(starts_at, "starts_at").error;
      if (startErr) return res.status(400).json({ message: startErr });
      const endErr = parseDate(ends_at, "ends_at").error;
      if (endErr) return res.status(400).json({ message: endErr });

      if (starts_at && ends_at && Date.parse(ends_at) <= Date.parse(starts_at)) {
        return res
          .status(400)
          .json({ message: "ends_at must be after starts_at" });
      }

      if (message !== undefined && typeof message !== "string") {
        return res.status(400).json({ message: "message must be a string" });
      }

      const window = await MaintenanceService.createWindow({
        message,
        starts_at,
        ends_at: ends_at ?? null,
        created_by: req.user?.user_id ?? null,
      });

      return res.status(201).json({ data: window });
    } catch (error) {
      logger.error(
        "Error creating maintenance window",
        { userId: req.user?.user_id },
        error instanceof Error ? error : new Error(String(error))
      );
      return res
        .status(500)
        .json({ message: "Failed to create maintenance window" });
    }
  },

  async updateWindow(req: AuthenticatedRequest, res: Response) {
    try {
      const { maintenanceWindowId } = req.params;
      const { message, starts_at, ends_at } = req.body ?? {};

      const startErr = parseDate(starts_at, "starts_at").error;
      if (startErr) return res.status(400).json({ message: startErr });
      const endErr = parseDate(ends_at, "ends_at").error;
      if (endErr) return res.status(400).json({ message: endErr });

      const window = await MaintenanceService.updateWindow(maintenanceWindowId, {
        message,
        starts_at,
        ends_at,
      });

      if (!window) {
        return res.status(404).json({ message: "Maintenance window not found" });
      }
      return res.status(200).json({ data: window });
    } catch (error) {
      logger.error(
        "Error updating maintenance window",
        { maintenanceWindowId: req.params?.maintenanceWindowId },
        error instanceof Error ? error : new Error(String(error))
      );
      return res
        .status(500)
        .json({ message: "Failed to update maintenance window" });
    }
  },

  /** Lift maintenance now. Aborted games are NOT restored. */
  async endWindow(req: AuthenticatedRequest, res: Response) {
    try {
      const { maintenanceWindowId } = req.params;
      const window = await MaintenanceService.endWindow(maintenanceWindowId);

      if (!window) {
        return res.status(404).json({ message: "Maintenance window not found" });
      }
      return res.status(200).json({ data: window });
    } catch (error) {
      logger.error(
        "Error ending maintenance window",
        { maintenanceWindowId: req.params?.maintenanceWindowId },
        error instanceof Error ? error : new Error(String(error))
      );
      return res
        .status(500)
        .json({ message: "Failed to end maintenance window" });
    }
  },

  async deleteWindow(req: AuthenticatedRequest, res: Response) {
    try {
      const { maintenanceWindowId } = req.params;
      const deleted = await MaintenanceService.deleteWindow(maintenanceWindowId);

      if (!deleted) {
        return res.status(404).json({ message: "Maintenance window not found" });
      }
      return res.status(204).send();
    } catch (error) {
      logger.error(
        "Error deleting maintenance window",
        { maintenanceWindowId: req.params?.maintenanceWindowId },
        error instanceof Error ? error : new Error(String(error))
      );
      return res
        .status(500)
        .json({ message: "Failed to delete maintenance window" });
    }
  },
};

export default MaintenanceController;
