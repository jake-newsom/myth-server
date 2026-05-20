// src/api/routes/card.routes.ts
import { Router } from "express";
import CardController from "../controllers/card.controller";
import optionalAuth from "../middlewares/optionalAuth.middleware";

// Create router instance
const router = Router();

// Optional auth: admins with a valid token see unreleased catalog entries
router.get("/", optionalAuth, CardController.getAllStaticCards);
router.get("/:cardId", optionalAuth, CardController.getStaticCardById);

export default router;
