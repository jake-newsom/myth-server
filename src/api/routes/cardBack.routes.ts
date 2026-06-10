import { Router } from "express";
import CardBackController from "../controllers/cardBack.controller";
import { authenticateJWT } from "../middlewares/auth.middleware";

const router = Router();

router.get("/", authenticateJWT, CardBackController.listActiveCardBacks);
router.get("/owned", authenticateJWT, CardBackController.listOwnedCardBacks);

export default router;
