import { Request, Response } from "express";
import PackService from "../../services/pack.service";
import UserModel from "../../models/user.model";
import { AuthenticatedRequest } from "../../types";

const PackController = {
  async openPack(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.user_id;
      const { setId } = req.body;

      if (!userId) {
        return res.status(401).json({
          status: "error",
          message: "User not authenticated",
        });
      }

      if (!setId) {
        return res.status(400).json({
          status: "error",
          message: "Set ID is required",
        });
      }

      const result = await PackService.openPack(userId, setId);

      if (!result) {
        return res.status(400).json({
          status: "error",
          message: "Failed to open pack",
        });
      }

      return res.status(200).json({
        cards: result.cards,
        remainingPacks: result.remainingPacks,
      });
    } catch (error) {
      console.error("Error opening pack:", error);

      if (error instanceof Error) {
        return res.status(400).json({
          status: "error",
          message: error.message,
        });
      }

      return res.status(500).json({
        status: "error",
        message: "Internal server error",
      });
    }
  },

  async getUserPacks(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.user_id;

      if (!userId) {
        return res.status(401).json({
          status: "error",
          message: "User not authenticated",
        });
      }

      const packCount = await UserModel.getPackCount(userId);

      return res.status(200).json({
        pack_count: packCount,
      });
    } catch (error) {
      console.error("Error getting user pack count:", error);
      return res.status(500).json({
        status: "error",
        message: "Internal server error",
      });
    }
  },
};

export default PackController;
