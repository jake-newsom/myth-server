import { Router } from "express";
import authMiddleware from "../middlewares/auth.middleware";
import {
  moderateRateLimit,
  lenientRateLimit,
} from "../middlewares/rateLimit.middleware";
import * as achievementController from "../controllers/achievement.controller";

const router = Router();

/**
 * GET /api/achievements
 * Get all available achievements (public endpoint)
 * Query params:
 * - include_inactive: boolean (optional) - include inactive achievements
 */
router.get(
  "/",
  lenientRateLimit, // Lenient rate limiting for public achievements list
  achievementController.getAllAchievements
);

/**
 * GET /api/achievements/categories
 * Get achievement categories with counts
 */
router.get(
  "/categories",
  lenientRateLimit, // Lenient rate limiting for categories
  achievementController.getAchievementCategories
);

/**
 * GET /api/achievements/:achievementKey
 * Get specific achievement details by key
 * Params:
 * - achievementKey: string - achievement key identifier
 */
router.get(
  "/:achievementKey",
  lenientRateLimit, // Lenient rate limiting for achievement details
  achievementController.getAchievementDetails
);

/**
 * GET /api/achievements/me/progress
 * Get user's achievement progress
 * Query params:
 * - category: string (optional) - filter by category
 * - completed: boolean (optional) - show only completed achievements
 * - unclaimed: boolean (optional) - show only unclaimed achievements
 */
router.get(
  "/me/progress",
  authMiddleware.protect, // Requires authentication
  moderateRateLimit, // Moderate rate limiting for user-specific data
  achievementController.getUserAchievements
);

/**
 * GET /api/achievements/me/stats
 * Get user's achievement statistics
 */
router.get(
  "/me/stats",
  authMiddleware.protect, // Requires authentication
  moderateRateLimit, // Moderate rate limiting for stats
  achievementController.getAchievementStats
);

/**
 * GET /api/achievements/me/recent
 * Get recently completed achievements for the user
 * Query params:
 * - limit: number (optional, default: 10, max: 50) - number of recent achievements
 */
router.get(
  "/me/recent",
  authMiddleware.protect, // Requires authentication
  moderateRateLimit, // Moderate rate limiting for recent achievements
  achievementController.getRecentlyCompletedAchievements
);

/**
 * POST /api/achievements/:achievementId/claim
 * Claim rewards for a completed achievement
 * Params:
 * - achievementId: string - achievement ID to claim
 */
router.post(
  "/:achievementId/claim",
  authMiddleware.protect, // Requires authentication
  moderateRateLimit, // Strict rate limiting for reward claiming
  achievementController.claimAchievementReward
);

export default router;
