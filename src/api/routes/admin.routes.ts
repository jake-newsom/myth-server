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

router.post("/create-ai-user", AdminController.createAIUser);

router.post("/create-ai-decks", AdminController.createAIDecks);

router.post("/trigger-ai-fate-pick", AdminController.triggerAIFatePick);

router.get("/debug-fate-picks", AdminController.debugFatePicks);

router.post("/give-fate-coins", AdminController.giveUserFateCoins);

router.post("/fix-fate-picks-tables", AdminController.fixFatePicksTables);

router.post("/trigger-daily-rewards", AdminController.triggerDailyRewards);

export default router;
