import { Router } from "express";
import CharacterController from "../controllers/character.controller";

const router = Router();

// Public routes (no authentication required)
router.get("/", CharacterController.getAllCharacters);

export default router;
