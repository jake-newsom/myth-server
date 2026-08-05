import { Response } from "express";
import { AuthenticatedRequest } from "../../types";
import OnboardingService from "../../services/onboarding.service";
import logger from "../../utils/logger";

const OnboardingController = {
  /**
   * Per-milestone status for the onboarding reward track. Reads the ledger, so
   * it reports exactly what has been granted and what the player has claimed.
   */
  async getStatus(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.user_id;
      const createdAt = req.user?.created_at;

      if (!userId || !createdAt) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const status = await OnboardingService.getStatus(
        userId,
        createdAt instanceof Date ? createdAt : new Date(createdAt)
      );

      return res.status(200).json(status);
    } catch (error) {
      logger.error(
        "Error fetching onboarding status",
        { userId: req.user?.user_id },
        error instanceof Error ? error : new Error(String(error))
      );
      return res
        .status(500)
        .json({ message: "Failed to fetch onboarding status" });
    }
  },
};

export default OnboardingController;
