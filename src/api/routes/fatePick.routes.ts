import { Router } from "express";
import authMiddleware from "../middlewares/auth.middleware";
import {
  strictRateLimit,
  moderateRateLimit,
  lenientRateLimit,
} from "../middlewares/rateLimit.middleware";
import * as fatePickController from "../controllers/fatePick.controller";

const router = Router();

/**
 * GET /api/fate-picks
 * Get available wonder picks for the authenticated user (paginated)
 * Query params:
 * - page: number (default: 1)
 * - limit: number (max: 50, default: 20)
 */
router.get(
  "/",
  authMiddleware.protect, // Requires authentication
  lenientRateLimit, // Lenient rate limiting for browsing
  fatePickController.getAvailableFatePicks
);

/**
 * GET /api/fate-picks/stats
 * Get wonder pick statistics (public endpoint)
 */
router.get(
  "/stats",
  lenientRateLimit, // Public endpoint with lenient rate limiting
  fatePickController.getFatePickStats
);

/**
 * GET /api/fate-picks/history
 * Get user's wonder pick participation history
 * Query params:
 * - page: number (default: 1)
 * - limit: number (max: 50, default: 20)
 */
router.get(
  "/history",
  authMiddleware.protect, // Requires authentication
  moderateRateLimit, // Moderate rate limiting for history queries
  fatePickController.getUserParticipationHistory
);

/**
 * GET /api/fate-picks/:fatePickId
 * Get specific wonder pick details
 */
router.get(
  "/:fatePickId",
  authMiddleware.protect, // Requires authentication
  moderateRateLimit, // Moderate rate limiting for individual queries
  fatePickController.getFatePickDetails
);

/**
 * POST /api/fate-picks/:fatePickId/participate
 * Participate in a wonder pick (spend wonder coins and shuffle)
 */
router.post(
  "/:fatePickId/participate",
  authMiddleware.protect, // Requires authentication
  moderateRateLimit, // Strict rate limiting for participation (spending currency)
  fatePickController.participateInFatePick
);

/**
 * POST /api/fate-picks/:fatePickId/select
 * Select a card position to reveal the result
 * Body: { selectedPosition: number (0-4) }
 */
router.post(
  "/:fatePickId/select",
  authMiddleware.protect, // Requires authentication
  moderateRateLimit, // Strict rate limiting for card selection (final action)
  fatePickController.selectCardPosition
);

// Note: Admin endpoints for awarding wonder coins can be added later
// when admin middleware is implemented

export default router;
