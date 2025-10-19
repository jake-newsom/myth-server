import { Router } from "express";
import PowerUpController from "../controllers/powerUp.controller";
import { authenticateJWT } from "../middlewares/auth.middleware";

const router = Router();

// POST /api/power-ups/apply - Apply a level up boost to a user card
router.post("/apply", authenticateJWT, PowerUpController.applyPowerUp);

// GET /api/power-ups/:userCardInstanceId - Get power up information for a specific user card
router.get(
  "/:userCardInstanceId",
  authenticateJWT,
  PowerUpController.getPowerUp
);

// GET /api/power-ups/:userCardInstanceId/validate - Validate if a power up can be applied
router.get(
  "/:userCardInstanceId/validate",
  authenticateJWT,
  PowerUpController.validatePowerUp
);

export default router;
