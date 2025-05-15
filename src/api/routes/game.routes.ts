import { Router } from "express";
import gameController from "../controllers/game.controller";
import authMiddleware from "../middlewares/auth.middleware";

const router = Router();

// Create a new solo game against AI
router.post(
  "/solo",
  authMiddleware.authenticateJWT,
  gameController.startSoloGame
);

// Get game state
router.get("/:gameId", authMiddleware.authenticateJWT, gameController.getGame);

// Submit an action for a game (place card, end turn, etc.)
router.post(
  "/:gameId/actions",
  authMiddleware.authenticateJWT,
  gameController.submitAction
);

export default router;
