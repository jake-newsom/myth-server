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
router.post("/facebook", authRateLimit, AuthController.facebookAuth);
router.post("/refresh", authRateLimit, AuthController.refresh);

// Facebook OAuth callback (for web-based OAuth flow)
router.get("/facebook/callback", AuthController.facebookCallback);

// Facebook compliance endpoints (no rate limiting as they're called by Facebook)
router.post("/facebook/deauthorize", AuthController.facebookDeauthorize);
router.post("/facebook/data-deletion", AuthController.facebookDataDeletion);

// Protected auth routes - require authentication
router.post("/logout", protect, AuthController.logout);
router.post("/logout-all", protect, AuthController.logoutAll);
router.get("/sessions", protect, moderateRateLimit, AuthController.getSessions);

// Facebook account linking (protected routes)
router.post(
  "/facebook/link",
  protect,
  moderateRateLimit,
  AuthController.facebookLink
);
router.delete(
  "/facebook/unlink",
  protect,
  moderateRateLimit,
  AuthController.facebookUnlink
);

export default router;
