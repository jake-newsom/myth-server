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

export default router;
