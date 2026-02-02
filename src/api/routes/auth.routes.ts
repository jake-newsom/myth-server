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
router.post("/apple", authRateLimit, AuthController.appleAuth);
router.post("/google", authRateLimit, AuthController.googleAuth);
router.post("/refresh", authRateLimit, AuthController.refresh);

// Facebook compliance endpoints (no rate limiting as they're called by Facebook)
router.post("/facebook/deauthorize", AuthController.facebookDeauthorize);
router.post("/facebook/data-deletion", AuthController.facebookDataDeletion);
router.get(
  "/facebook/data-deletion-status",
  AuthController.facebookDataDeletionStatus
);

// Protected auth routes - require authentication
router.post("/logout", protect, AuthController.logout);
router.post("/logout-all", protect, AuthController.logoutAll);
router.get("/sessions", protect, moderateRateLimit, AuthController.getSessions);

// Social account linking (protected routes)
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

router.post(
  "/apple/link",
  protect,
  moderateRateLimit,
  AuthController.appleLink
);
router.delete(
  "/apple/unlink",
  protect,
  moderateRateLimit,
  AuthController.appleUnlink
);

router.post(
  "/google/link",
  protect,
  moderateRateLimit,
  AuthController.googleLink
);
router.delete(
  "/google/unlink",
  protect,
  moderateRateLimit,
  AuthController.googleUnlink
);

export default router;
