import { Router } from "express";
import authMiddleware from "../middlewares/auth.middleware";
import {
  strictRateLimit,
  moderateRateLimit,
  lenientRateLimit,
} from "../middlewares/rateLimit.middleware";
import * as leaderboardController from "../controllers/leaderboard.controller";

const router = Router();

/**
 * GET /api/leaderboard
 * Get current leaderboard with optional user context
 * Query params:
 * - season: string (optional) - specific season to view
 * - page: number (optional, default: 1) - pagination
 * - limit: number (optional, default: 50, max: 100) - results per page
 */
router.get(
  "/",
  lenientRateLimit, // Lenient rate limiting for public leaderboard
  leaderboardController.getLeaderboard
);

/**
 * GET /api/leaderboard/stats
 * Get leaderboard statistics and tier distribution
 * Query params:
 * - season: string (optional) - specific season to view
 */
router.get(
  "/stats",
  lenientRateLimit, // Lenient rate limiting for stats
  leaderboardController.getLeaderboardStats
);

/**
 * GET /api/leaderboard/me
 * Get current user's detailed ranking information
 * Query params:
 * - season: string (optional) - specific season to view
 */
router.get(
  "/me",
  authMiddleware.protect, // Requires authentication
  moderateRateLimit, // Moderate rate limiting for user-specific data
  leaderboardController.getUserRanking
);

/**
 * GET /api/leaderboard/me/history
 * Get user's rank history across seasons
 * Query params:
 * - seasons: string[] (optional) - specific seasons to include
 */
router.get(
  "/me/history",
  authMiddleware.protect, // Requires authentication
  moderateRateLimit, // Moderate rate limiting for history
  leaderboardController.getUserRankHistory
);

/**
 * GET /api/leaderboard/me/around
 * Get leaderboard around current user's position
 * Query params:
 * - season: string (optional) - specific season to view
 * - range: number (optional, default: 10, max: 25) - players above/below
 */
router.get(
  "/me/around",
  authMiddleware.protect, // Requires authentication
  moderateRateLimit, // Moderate rate limiting for contextual view
  leaderboardController.getLeaderboardAroundUser
);

/**
 * GET /api/leaderboard/user/:identifier
 * Get public ranking for a specific user
 * Params:
 * - identifier: string - username or user_id
 * Query params:
 * - season: string (optional) - specific season to view
 */
router.get(
  "/user/:identifier",
  lenientRateLimit, // Lenient rate limiting for public user lookup
  leaderboardController.getPublicUserRanking
);

/**
 * POST /api/leaderboard/me/initialize
 * Initialize user ranking for current/specific season
 * Body:
 * - season: string (optional) - season to initialize for
 */
router.post(
  "/me/initialize",
  authMiddleware.protect, // Requires authentication
  strictRateLimit, // Strict rate limiting for initialization
  leaderboardController.initializeUserRanking
);

export default router;
