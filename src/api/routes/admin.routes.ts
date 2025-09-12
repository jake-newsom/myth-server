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

// Database Management Endpoints
router.post("/migrate", authenticateJWT, AdminController.runMigrations);

router.post("/seed", authenticateJWT, AdminController.seedDatabase);

router.get(
  "/database-status",
  authenticateJWT,
  AdminController.getDatabaseStatus
);

export default router;
