import { Router } from "express";
import OnboardingController from "../controllers/onboarding.controller";
import { authenticateJWT } from "../middlewares/auth.middleware";

const router = Router();

router.get("/status", authenticateJWT, OnboardingController.getStatus);

export default router;
