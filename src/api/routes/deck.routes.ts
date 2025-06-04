// src/api/routes/deck.routes.ts
import express, { Router } from "express";
import DeckController from "../controllers/deck.controller";
import authMiddleware from "../middlewares/auth.middleware";

// Create router instance
const router = Router();

// CRUD operations for decks
router.post("/", authMiddleware.protect, DeckController.createDeck);
router.put("/:deckId", authMiddleware.protect, DeckController.updateDeck);
router.delete("/:deckId", authMiddleware.protect, DeckController.deleteDeck);

export default router;
