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
  getLevelConfig,
} from "../controllers/xp.controller";

const router = Router();

// All XP routes require authentication
router.use(authMiddleware.protect);

// Read-only endpoints (moderate rate limiting)
router.get("/level-config", moderateRateLimit, getLevelConfig);
router.get("/pools", moderateRateLimit, getXpPools);
router.get("/pools/:cardName", moderateRateLimit, getXpPool);
router.get("/history", moderateRateLimit, getXpTransferHistory);

// Write operations (strict rate limiting to prevent abuse)
router.post("/transfer", moderateRateLimit, transferXp);
router.post("/sacrifice", moderateRateLimit, sacrificeCards);
router.post("/sacrifice-extras", moderateRateLimit, sacrificeExtraCards);
router.post("/apply", moderateRateLimit, applyXp);

export default router;
