import { Router } from "express";
import authMiddleware from "../middlewares/auth.middleware";
import { requireAdmin } from "../middlewares/adminAuth.middleware";
import {
  strictRateLimit,
  moderateRateLimit,
  lenientRateLimit,
} from "../middlewares/rateLimit.middleware";
import * as seasonController from "../controllers/season.controller";

const router = Router();

router.get(
  "/current",
  authMiddleware.protect,
  moderateRateLimit,
  seasonController.getCurrentSeason
);

router.get(
  "/current/standings",
  lenientRateLimit,
  seasonController.getCurrentStandings
);

router.get(
  "/current/leaderboard",
  lenientRateLimit,
  seasonController.getSetLeaderboard
);

router.get(
  "/current/choice",
  authMiddleware.protect,
  moderateRateLimit,
  seasonController.getMyChoice
);

router.post(
  "/current/choice",
  authMiddleware.protect,
  strictRateLimit,
  seasonController.chooseMythology
);

router.get(
  "/current/me",
  authMiddleware.protect,
  moderateRateLimit,
  seasonController.getMyProgress
);

router.get(
  "/current/rewards/status",
  authMiddleware.protect,
  moderateRateLimit,
  seasonController.getMyRewardStatus
);

router.post(
  "/ensure-buffer",
  authMiddleware.protect,
  requireAdmin,
  strictRateLimit,
  seasonController.ensureSeasonBuffer
);

router.get(
  "/",
  authMiddleware.protect,
  requireAdmin,
  moderateRateLimit,
  seasonController.listSeasons
);

router.patch(
  "/:seasonId/dates",
  authMiddleware.protect,
  requireAdmin,
  strictRateLimit,
  seasonController.updateSeasonDates
);

export default router;
