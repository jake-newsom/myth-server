import { Router } from "express";
import gameController from "../controllers/game.controller";
import authMiddleware from "../middlewares/auth.middleware";
import {
  gameActionRateLimit,
  moderateRateLimit,
} from "../middlewares/rateLimit.middleware";

const router = Router();

// Create a new solo game against AI (moderate rate limiting)
router.post(
  "/solo",
  authMiddleware.protect,
  moderateRateLimit,
  gameController.startSoloGame
);

// Get game state (moderate rate limiting for reads)
router.get(
  "/:gameId",
  authMiddleware.protect,
  moderateRateLimit,
  gameController.getGame
);

// Submit an action for a game (strict rate limiting for game actions)
router.post(
  "/:gameId/actions",
  authMiddleware.protect,
  gameActionRateLimit,
  gameController.submitAction
);

// Submit an AI action for a solo game (strict rate limiting)
router.post(
  "/:gameId/ai-action",
  authMiddleware.protect,
  gameActionRateLimit,
  gameController.submitAIAction
);

export default router;
