// myth-server/src/api/routes/auth.routes.ts
import express from "express";
import AuthController from "../controllers/auth.controller";
import { authRateLimit } from "../middlewares/rateLimit.middleware";

const router = express.Router();

// Auth routes - rate limited to prevent brute force attacks
router.post("/register", authRateLimit, AuthController.register);
router.post("/login", authRateLimit, AuthController.login);

export default router;
