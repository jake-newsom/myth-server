// myth-server/src/api/middlewares/maintenance.middleware.ts

import { Request, Response, NextFunction } from "express";
import MaintenanceService from "../../services/maintenance.service";

/**
 * HTTP status for "maintenance is on, don't start a game".
 *
 * 503 is the correct code, but shipped clients have never seen one from these
 * routes and we can't know how each build renders it. The error BODY therefore
 * matches the shape these routes already return on failure ({ error: ... }),
 * so an old client falls back to its generic error path rather than an
 * unhandled state. New clients can branch on `maintenance: true`.
 */
const MAINTENANCE_STATUS = 503;

/**
 * Blocks game creation while a maintenance window is open.
 *
 * Applied to the routes that START a game, never to the ones that read or act
 * on an existing one. Those don't need it: the window's sweep has already moved
 * every in-flight game to 'aborted', so the normal ownership/status checks make
 * them 404 on their own. Gating them here as well would only change a clear
 * "game not found" into a 503 the client is less likely to handle.
 */
export const blockDuringMaintenance = async (
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  // getStatus fails open, so a database problem here lets players through
  // rather than taking the game down.
  const status = await MaintenanceService.getStatus();

  if (!status.active) {
    next();
    return;
  }

  res.status(MAINTENANCE_STATUS).json({
    error:
      status.message ??
      "The servers are down for maintenance. Please try again soon.",
    maintenance: true,
    ends_at: status.ends_at,
  });
};

export default blockDuringMaintenance;
