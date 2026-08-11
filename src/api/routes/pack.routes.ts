import { Router } from "express";
import PackController from "../controllers/pack.controller";
import authMiddleware, {
  authenticateJWT,
} from "../middlewares/auth.middleware";
import requireAdmin from "../middlewares/adminAuth.middleware";
import optionalAuth from "../middlewares/optionalAuth.middleware";
import {
  packOpeningRateLimit,
  moderateRateLimit,
} from "../middlewares/rateLimit.middleware";

const router = Router();

// GET /api/packs/rates - Public: current pack opening rate configuration
router.get("/rates", PackController.getPackRates);

// GET /api/packs/available - Public: packs the shop should list.
// Declared before "/" so neither shadows the other, and before "/:packId"
// so "available" is never read as an id.
router.get("/available", PackController.getAvailablePacks);

// GET /api/packs/catalog - Public: packs + the card_variant_ids each contains,
// for the client's Collection view. Optional auth so admins also see
// unreleased catalog entries. Declared before "/:packId" for the same reason
// as "/available".
router.get("/catalog", optionalAuth, PackController.getPackCatalog);

// Get user's pack inventory (the pack_count currency, not pack products)
router.get(
  "/",
  authMiddleware.protect,
  moderateRateLimit,
  PackController.getUserPacks
);

// --- Admin pack authoring ---
router.get("/all", authenticateJWT, requireAdmin, PackController.getAllPacks);
router.post("/", authenticateJWT, requireAdmin, PackController.createPack);
router.put(
  "/:packId",
  authenticateJWT,
  requireAdmin,
  PackController.updatePack
);
router.put(
  "/:packId/cards",
  authenticateJWT,
  requireAdmin,
  PackController.setPackCards
);
router.delete(
  "/:packId",
  authenticateJWT,
  requireAdmin,
  PackController.deletePack
);

// Open a pack - requires authentication (special pack opening rate limiting)
router.post(
  "/open",
  authMiddleware.protect,
  packOpeningRateLimit,
  PackController.openPack
);

export default router;
