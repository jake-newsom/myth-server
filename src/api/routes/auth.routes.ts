// myth-server/src/api/routes/auth.routes.ts
import express from "express";
import AuthController from "../controllers/auth.controller";

const router = express.Router();

// Auth routes - will be implemented in upcoming sections
router.post("/register", AuthController.register);
router.post("/login", AuthController.login);

export default router;
