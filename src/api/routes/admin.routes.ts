import { Router } from "express";
import AdminController from "../controllers/admin.controller";
import { authenticateJWT } from "../middlewares/auth.middleware";

const router = Router();

// All admin routes require authentication
router.post("/give-packs", authenticateJWT, AdminController.givePacksToUser);
router.post(
  "/set-pack-quantity",
  authenticateJWT,
  AdminController.setUserPackQuantity
);
router.get(
  "/user-pack-count/:userId",
  authenticateJWT,
  AdminController.getUserPackCount
);

// Database Management Endpoints (No auth required for initial setup)
router.post("/migrate", AdminController.runMigrations);

router.post("/reset-migrations", AdminController.resetMigrations);

router.post("/seed", AdminController.seedDatabase);

router.get("/database-status", AdminController.getDatabaseStatus);

export default router;
