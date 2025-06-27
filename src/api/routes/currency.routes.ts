import { Router } from "express";
import authMiddleware from "../middlewares/auth.middleware";
import {
  strictRateLimit,
  moderateRateLimit,
} from "../middlewares/rateLimit.middleware";
import {
  getCurrencies,
  getPackPrices,
  purchasePacks,
  awardCurrency,
} from "../controllers/currency.controller";

const router = Router();

// All currency routes require authentication
router.use(authMiddleware.protect);

// Read-only endpoints (moderate rate limiting)
router.get("/", moderateRateLimit, getCurrencies);
router.get("/pack-prices", moderateRateLimit, getPackPrices);

// Write operations (strict rate limiting to prevent abuse)
router.post("/purchase-packs", strictRateLimit, purchasePacks);
router.post("/award", strictRateLimit, awardCurrency);

export default router;
