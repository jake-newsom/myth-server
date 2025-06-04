// src/api/routes/card.routes.ts
import express, { Router } from "express";
import CardController from "../controllers/card.controller";

// Create router instance
const router = Router();

// Public endpoints for static card data - no authentication required
router.get("/", CardController.getAllStaticCards);
router.get("/:cardId", CardController.getStaticCardById);

export default router;
