import { Router } from "express";
import PackController from "../controllers/pack.controller";
import { authenticateJWT } from "../middlewares/auth.middleware";

const router = Router();

// Open a pack - requires authentication
router.post("/open", authenticateJWT, PackController.openPack);

// Get user's pack inventory - requires authentication
router.get("/", authenticateJWT, PackController.getUserPacks);

export default router;
