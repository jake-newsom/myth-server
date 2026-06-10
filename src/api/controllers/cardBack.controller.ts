import { Response } from "express";
import { AuthenticatedRequest } from "../../types";
import CardBackService from "../../services/cardBack.service";
import logger from "../../utils/logger";

const CardBackController = {
  async listActiveCardBacks(_req: AuthenticatedRequest, res: Response) {
    try {
      const backs = await CardBackService.getActiveCatalog();
      return res.status(200).json({ data: backs });
    } catch (error) {
      logger.error(
        "Error listing active card backs",
        {},
        error instanceof Error ? error : new Error(String(error))
      );
      return res.status(500).json({ message: "Failed to fetch card backs" });
    }
  },

  async listOwnedCardBacks(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const backs = await CardBackService.getUserOwnedCardBacks(userId);
      return res.status(200).json({ data: backs });
    } catch (error) {
      logger.error(
        "Error listing owned card backs",
        { userId: req.user?.user_id },
        error instanceof Error ? error : new Error(String(error))
      );
      return res.status(500).json({ message: "Failed to fetch owned card backs" });
    }
  },
};

export default CardBackController;
