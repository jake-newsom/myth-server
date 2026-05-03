import { Router } from "express";
import {
  getAllUserCards,
  setUserCardLockState,
  setUserCardBorder,
  equipBorderOnAllEmpty,
  unequipAllBorders,
} from "../controllers/userCard.controller";
import { authenticateJWT } from "../middlewares/auth.middleware";

const router = Router();

// Bulk border operations are listed before the parameterised border route so
// Express matches `/borders/...` before `/:userCardInstanceId/...`.
router.post("/borders/equip-all", authenticateJWT, equipBorderOnAllEmpty);
router.post("/borders/unequip-all", authenticateJWT, unequipAllBorders);

// GET /api/user-cards - Fetches all cards owned by the authenticated user with optional filters
router.get("/", authenticateJWT, getAllUserCards);
router.patch("/:userCardInstanceId/lock", authenticateJWT, setUserCardLockState);
router.patch("/:userCardInstanceId/border", authenticateJWT, setUserCardBorder);

export default router;
