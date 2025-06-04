import { Router } from "express";
import { getAllUserCards } from "../controllers/userCard.controller";
import { authenticateJWT } from "../middlewares/auth.middleware";

const router = Router();

// GET /api/user-cards - Fetches all cards owned by the authenticated user with optional filters
router.get("/", authenticateJWT, getAllUserCards);

export default router;
