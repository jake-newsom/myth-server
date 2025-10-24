// myth-server/src/api/routes/auth.routes.ts
import express from "express";
import AuthController from "../controllers/auth.controller";
import {
  authRateLimit,
  moderateRateLimit,
} from "../middlewares/rateLimit.middleware";
import { protect } from "../middlewares/auth.middleware";

const router = express.Router();

// Public auth routes - rate limited to prevent brute force attacks
router.post("/register", authRateLimit, AuthController.register);
router.post("/login", authRateLimit, AuthController.login);
router.post("/refresh", authRateLimit, AuthController.refresh);

// Protected auth routes - require authentication
router.post("/logout", protect, AuthController.logout);
router.post("/logout-all", protect, AuthController.logoutAll);
router.get("/sessions", protect, moderateRateLimit, AuthController.getSessions);

export default router;
