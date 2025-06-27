import { Router } from "express";
import PackController from "../controllers/pack.controller";
import authMiddleware from "../middlewares/auth.middleware";
import {
  packOpeningRateLimit,
  moderateRateLimit,
} from "../middlewares/rateLimit.middleware";

const router = Router();

// Get user's pack inventory - requires authentication (moderate rate limiting)
router.get(
  "/",
  authMiddleware.protect,
  moderateRateLimit,
  PackController.getUserPacks
);

// Open a pack - requires authentication (special pack opening rate limiting)
router.post(
  "/open",
  authMiddleware.protect,
  packOpeningRateLimit,
  PackController.openPack
);

export default router;
