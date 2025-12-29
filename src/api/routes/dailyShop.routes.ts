import { Router } from "express";
import DailyShopController from "../controllers/dailyShop.controller";
import { authenticateJWT } from "../middlewares/auth.middleware";
import { requireAdmin } from "../middlewares/adminAuth.middleware";
import { moderateRateLimit } from "../middlewares/rateLimit.middleware";

const router = Router();

// User endpoints (require authentication)
router.get(
  "/",
  authenticateJWT,
  moderateRateLimit,
  DailyShopController.getShop
);

router.post(
  "/purchase",
  authenticateJWT,
  moderateRateLimit,
  DailyShopController.purchaseItem
);

// Admin endpoints (require authentication + admin role)
router.get(
  "/admin/config",
  authenticateJWT,
  requireAdmin,
  DailyShopController.getShopConfig
);

router.put(
  "/admin/config",
  authenticateJWT,
  requireAdmin,
  DailyShopController.updateShopConfig
);

router.post(
  "/admin/refresh",
  authenticateJWT,
  requireAdmin,
  DailyShopController.refreshShop
);

router.get(
  "/admin/stats",
  authenticateJWT,
  requireAdmin,
  DailyShopController.getShopStats
);

router.get(
  "/admin/rotations",
  authenticateJWT,
  requireAdmin,
  DailyShopController.getRotationStates
);

router.post(
  "/admin/reset-limits",
  authenticateJWT,
  requireAdmin,
  DailyShopController.resetUserLimits
);

export default router;
