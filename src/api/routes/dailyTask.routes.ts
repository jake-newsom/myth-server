import { Router } from "express";
import authMiddleware from "../middlewares/auth.middleware";
import * as dailyTaskController from "../controllers/dailyTask.controller";

const router = Router();

/**
 * GET /api/daily-tasks
 * Get current daily tasks and user's progress
 */
router.get(
  "/",
  authMiddleware.protect,
  dailyTaskController.getDailyTasks
);

/**
 * POST /api/daily-tasks/claim
 * Claim the next available daily task reward tier
 */
router.post(
  "/claim",
  authMiddleware.protect,
  dailyTaskController.claimDailyTaskReward
);

export default router;

