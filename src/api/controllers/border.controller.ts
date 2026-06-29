import { Response } from "express";
import { AuthenticatedRequest } from "../../types";
import BorderService from "../../services/border.service";
import logger from "../../utils/logger";
import { catalogOptionsFromRequest } from "../../utils/catalogRelease";

/**
 * Border Controller
 *
 * User-facing read endpoints for the border catalog and player ownership.
 * All write endpoints (equip / unequip / admin CRUD) live under
 * userCard.controller and admin.controller respectively, since they belong
 * conceptually to those domains.
 */

const BorderController = {
  /**
   * GET /api/borders
   *
   * Returns the active border catalog. Cached at the service layer.
   */
  async listActiveBorders(req: AuthenticatedRequest, res: Response) {
    try {
      const borders = await BorderService.getActiveCatalog(
        catalogOptionsFromRequest(req)
      );
      return res.status(200).json({ data: borders });
    } catch (error) {
      logger.error(
        "Error listing active borders",
        {},
        error instanceof Error ? error : new Error(String(error))
      );
      return res.status(500).json({ message: "Failed to fetch borders" });
    }
  },

  /**
   * GET /api/borders/owned
   *
   * Returns the borders owned by the authenticated user, joined with catalog
   * metadata.
   */
  async listOwnedBorders(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const borders = await BorderService.getUserOwnedBorders(userId);
      return res.status(200).json({ data: borders });
    } catch (error) {
      logger.error(
        "Error listing user-owned borders",
        { userId: req.user?.user_id },
        error instanceof Error ? error : new Error(String(error))
      );
      return res
        .status(500)
        .json({ message: "Failed to fetch owned borders" });
    }
  },
};

export default BorderController;
