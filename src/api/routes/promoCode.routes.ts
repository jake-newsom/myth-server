import { Router } from "express";
import PromoCodeController from "../controllers/promoCode.controller";
import { authenticateJWT } from "../middlewares/auth.middleware";
import { requireAdmin } from "../middlewares/adminAuth.middleware";
import { strictRateLimit } from "../middlewares/rateLimit.middleware";

const router = Router();

// ---- Player endpoints -------------------------------------------------------
// Rate-limited: redemption is the natural target for code-guessing.
router.post(
  "/redeem",
  authenticateJWT,
  strictRateLimit,
  PromoCodeController.redeem
);
router.get(
  "/:code/preview",
  authenticateJWT,
  strictRateLimit,
  PromoCodeController.preview
);

// ---- Admin endpoints --------------------------------------------------------
router.get(
  "/admin",
  authenticateJWT,
  requireAdmin,
  PromoCodeController.listPromoCodes
);
router.post(
  "/admin",
  authenticateJWT,
  requireAdmin,
  PromoCodeController.createPromoCode
);
router.get(
  "/admin/:promoCodeId",
  authenticateJWT,
  requireAdmin,
  PromoCodeController.getPromoCode
);
router.patch(
  "/admin/:promoCodeId",
  authenticateJWT,
  requireAdmin,
  PromoCodeController.updatePromoCode
);
router.delete(
  "/admin/:promoCodeId",
  authenticateJWT,
  requireAdmin,
  PromoCodeController.deletePromoCode
);
router.get(
  "/admin/:promoCodeId/redemptions",
  authenticateJWT,
  requireAdmin,
  PromoCodeController.listRedemptions
);

export default router;
