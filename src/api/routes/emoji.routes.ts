import { Router } from "express";
import EmojiController from "../controllers/emoji.controller";
import { authenticateJWT } from "../middlewares/auth.middleware";

const router = Router();

router.get("/me", authenticateJWT, EmojiController.getMine);
router.patch("/me", authenticateJWT, EmojiController.updateSettings);

export default router;
