// myth-server/src/api/routes/index.ts
import { Router } from "express";
import authRoutes from "./auth.routes";
import gameRoutes from "./game.routes";
import errorMiddleware from "../middlewares/error.middleware";

// Import matchmaking routes
const matchmakingRoutes = require("./matchmaking.routes");

const router = Router();

// API Routes
router.use("/auth", authRoutes);
router.use("/games", gameRoutes);
router.use("/matchmaking", matchmakingRoutes);

// Global error handler
router.use(errorMiddleware.handleErrors);

// Health check endpoint
router.get("/health", (_, res) => {
  res.status(200).json({
    status: "ok",
    message: "API is running",
    timestamp: new Date().toISOString(),
  });
});

// 404 Handler for any undefined API routes
router.use("*", (_, res) => {
  res.status(404).json({
    status: "error",
    message: "Endpoint not found",
  });
});

export default router;
