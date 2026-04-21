import { Router } from "express";
import {
  getAllUserCards,
  setUserCardLockState,
} from "../controllers/userCard.controller";
import { authenticateJWT } from "../middlewares/auth.middleware";

const router = Router();

// GET /api/user-cards - Fetches all cards owned by the authenticated user with optional filters
router.get("/", authenticateJWT, getAllUserCards);
router.patch("/:userCardInstanceId/lock", authenticateJWT, setUserCardLockState);

export default router;
