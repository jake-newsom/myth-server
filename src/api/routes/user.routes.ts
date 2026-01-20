// src/api/routes/user.routes.ts
import express, { Router } from "express";
import UserController from "../controllers/user.controller";
import authMiddleware from "../middlewares/auth.middleware";

// Create router instance
const router = Router();

// Protected user profile routes
router.get("/me", authMiddleware.protect, UserController.getMyProfile);
router.patch(
  "/me",
  authMiddleware.protect,
  UserController.updateAccountDetails
);
router.get(
  "/me/cards",
  authMiddleware.protect,
  UserController.getMyCardInstances
);
router.get("/me/decks", authMiddleware.protect, UserController.getMyDecks);
router.get(
  "/me/decks/:deckId",
  authMiddleware.protect,
  UserController.getMyDeckById
);
router.get(
  "/me/active-games",
  authMiddleware.protect,
  UserController.getMyActiveGames
);

// Monthly login rewards routes
router.get(
  "/me/monthly-login/status",
  authMiddleware.protect,
  UserController.getMonthlyLoginStatus
);
router.post(
  "/me/monthly-login/claim",
  authMiddleware.protect,
  UserController.claimMonthlyReward
);

// Account reset - accessible by user (for own account) or admin (for any account)
router.post(
  "/me/reset-account",
  authMiddleware.protect,
  UserController.resetAccount
);

export default router;
