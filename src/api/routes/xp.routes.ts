import { Router } from "express";
import authMiddleware from "../middlewares/auth.middleware";
import {
  strictRateLimit,
  moderateRateLimit,
} from "../middlewares/rateLimit.middleware";
import {
  getXpPools,
  getXpPool,
  transferXp,
  sacrificeCards,
  sacrificeExtraCards,
  applyXp,
  getXpTransferHistory,
} from "../controllers/xp.controller";

const router = Router();

// All XP routes require authentication
router.use(authMiddleware.protect);

// Read-only endpoints (moderate rate limiting)
router.get("/pools", moderateRateLimit, getXpPools);
router.get("/pools/:cardName", moderateRateLimit, getXpPool);
router.get("/history", moderateRateLimit, getXpTransferHistory);

// Write operations (strict rate limiting to prevent abuse)
router.post("/transfer", strictRateLimit, transferXp);
router.post("/sacrifice", strictRateLimit, sacrificeCards);
router.post("/sacrifice-extras", strictRateLimit, sacrificeExtraCards);
router.post("/apply", strictRateLimit, applyXp);

export default router;
