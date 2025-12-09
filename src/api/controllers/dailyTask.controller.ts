import { Response } from "express";
import { AuthenticatedRequest } from "../../types/middleware.types";
import DailyTaskService from "../../services/dailyTask.service";

export const getDailyTasks = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }

    const status = await DailyTaskService.getDailyTaskStatus(userId);
    if (!status) {
      res.status(500).json({ success: false, error: "Failed to get daily task status" });
      return;
    }

    res.status(200).json({
      success: true,
      ...status,
    });
  } catch (error) {
    console.error("Error getting daily tasks:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

export const claimDailyTaskReward = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }

    const result = await DailyTaskService.claimReward(userId);
    if (!result.success) {
      res.status(400).json(result);
      return;
    }

    res.status(200).json(result);
  } catch (error) {
    console.error("Error claiming daily task reward:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

