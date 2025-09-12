// myth-server/src/api/routes/index.ts
import { Router } from "express";
import authRoutes from "./auth.routes";
import gameRoutes from "./game.routes";
import userRoutes from "./user.routes";
import cardRoutes from "./card.routes";
import deckRoutes from "./deck.routes";
import userCardRoutes from "./userCard.routes";
import packRoutes from "./pack.routes";
import setRoutes from "./set.routes";
import adminRoutes from "./admin.routes";
import xpRoutes from "./xp.routes";
import currencyRoutes from "./currency.routes";
import friendsRoutes from "./friends.routes";
import leaderboardRoutes from "./leaderboard.routes";
import achievementRoutes from "./achievement.routes";
import fatePickRoutes from "./fatePick.routes";
import mailRoutes from "./mail.routes";
import healthRoutes from "./health.routes";
import { handleErrors } from "../middlewares/error.middleware";

// Import matchmaking routes
import matchmakingRoutes from "./matchmaking.routes";

const router = Router();

// API Routes
router.use("/auth", authRoutes);
router.use("/games", gameRoutes);
router.use("/matchmaking", matchmakingRoutes);
router.use("/users", userRoutes);
router.use("/cards", cardRoutes);
router.use("/decks", deckRoutes);
router.use("/user-cards", userCardRoutes);
router.use("/packs", packRoutes);
router.use("/sets", setRoutes);
router.use("/admin", adminRoutes);
router.use("/xp", xpRoutes);
router.use("/currency", currencyRoutes);
router.use("/friends", friendsRoutes);
router.use("/leaderboard", leaderboardRoutes);
router.use("/achievements", achievementRoutes);
router.use("/fate-picks", fatePickRoutes);
router.use("/mail", mailRoutes);
router.use("/health", healthRoutes);

// Global error handler
router.use(handleErrors);

// 404 Handler for any undefined API routes
router.use("*", (_, res) => {
  res.status(404).json({
    status: "error",
    message: "Endpoint not found",
  });
});

export default router;
