// src/api/routes/user.routes.ts
import express, { Router } from "express";
import UserController from "../controllers/user.controller";
import authMiddleware from "../middlewares/auth.middleware";

// Create router instance
const router = Router();

// Protected user profile routes
router.get("/me", authMiddleware.protect, UserController.getMyProfile);
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

export default router;
