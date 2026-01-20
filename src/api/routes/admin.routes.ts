import { Router } from "express";
import AdminController from "../controllers/admin.controller";
import { authenticateJWT } from "../middlewares/auth.middleware";
import { requireAdmin } from "../middlewares/adminAuth.middleware";

const router = Router();

// Apply authentication and admin check to ALL admin routes
router.use(authenticateJWT);
router.use(requireAdmin);

// ============================================================================
// USER MANAGEMENT ENDPOINTS
// ============================================================================

/**
 * Give packs to a specific user
 * POST /api/admin/give-packs
 * Body: { userId: string, quantity: number }
 */
router.post("/give-packs", AdminController.givePacksToUser);

/**
 * Set a user's pack quantity
 * POST /api/admin/set-pack-quantity
 * Body: { userId: string, quantity: number }
 */
router.post("/set-pack-quantity", AdminController.setUserPackQuantity);

/**
 * Get a user's pack count
 * GET /api/admin/user-pack-count/:userId
 */
router.get("/user-pack-count/:userId", AdminController.getUserPackCount);

/**
 * Give fate coins to a user
 * POST /api/admin/give-fate-coins
 * Body: { userId: string, amount: number }
 */
router.post("/give-fate-coins", AdminController.giveUserFateCoins);

// ============================================================================
// AUTOMATION TRIGGER ENDPOINTS (for manual override of scheduled tasks)
// ============================================================================

/**
 * Manually trigger AI fate pick generation (normally runs on schedule)
 * POST /api/admin/trigger-ai-fate-pick
 */
router.post("/trigger-ai-fate-pick", AdminController.triggerAIFatePick);

/**
 * Manually trigger daily rewards distribution (normally runs on schedule)
 * POST /api/admin/trigger-daily-rewards
 */
router.post("/trigger-daily-rewards", AdminController.triggerDailyRewards);

export default router;
