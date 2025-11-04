import { Router } from "express";
import DailyShopController from "../controllers/dailyShop.controller";
import { authenticateJWT } from "../middlewares/auth.middleware";
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

// Admin endpoints (require authentication - additional admin check should be added in production)
router.get("/admin/config", authenticateJWT, DailyShopController.getShopConfig);

router.put(
  "/admin/config",
  authenticateJWT,
  DailyShopController.updateShopConfig
);

router.post("/admin/refresh", authenticateJWT, DailyShopController.refreshShop);

router.get("/admin/stats", authenticateJWT, DailyShopController.getShopStats);

router.get(
  "/admin/rotations",
  authenticateJWT,
  DailyShopController.getRotationStates
);

router.post(
  "/admin/reset-limits",
  authenticateJWT,
  DailyShopController.resetUserLimits
);

export default router;
