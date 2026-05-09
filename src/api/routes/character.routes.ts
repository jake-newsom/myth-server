import { Router } from "express";
import CharacterController from "../controllers/character.controller";
import * as AchievementController from "../controllers/achievement.controller";
import authMiddleware from "../middlewares/auth.middleware";
import { moderateRateLimit } from "../middlewares/rateLimit.middleware";

const router = Router();

// Public routes (no authentication required)
router.get("/", CharacterController.getAllCharacters);

// Auth routes
router.get(
  "/achievements/me/all",
  authMiddleware.protect,
  moderateRateLimit,
  AchievementController.getAllCharacterAchievementPrimaries
);
router.get(
  "/:characterId/achievements/me",
  authMiddleware.protect,
  moderateRateLimit,
  AchievementController.getCharacterAchievementsForUser
);
router.get(
  "/:characterId/borders/eligible",
  authMiddleware.protect,
  moderateRateLimit,
  CharacterController.getCharacterEligibleBorders
);

export default router;
