import { Router } from "express";
import ForgeController from "../controllers/forge.controller";
import { authenticateJWT } from "../middlewares/auth.middleware";
import { moderateRateLimit } from "../middlewares/rateLimit.middleware";

const router = Router();

router.get("/", authenticateJWT, moderateRateLimit, ForgeController.getForge);
router.post("/draft", authenticateJWT, moderateRateLimit, ForgeController.saveDraft);
router.delete("/draft", authenticateJWT, moderateRateLimit, ForgeController.clearDraft);
router.post("/reforge", authenticateJWT, moderateRateLimit, ForgeController.reforge);
router.post("/craft", authenticateJWT, moderateRateLimit, ForgeController.craft);

export default router;
