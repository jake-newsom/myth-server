import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import compression from "compression";
import swaggerJSDoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import fs from "fs";
import path from "path";
import http from "http";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Import the API routes
import apiRoutes from "./api/routes";
import errorHandler from "./api/middlewares/errorHandler.middleware";
import AIAutomationService from "./services/aiAutomation.service";

// Setup Swagger
const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Myth API",
      version: "1.0.0",
      description: "API for the Myth card game",
    },
    servers: [
      {
        url: "http://localhost:3000",
        description: "Development server",
      },
    ],
  },
  // Path to API docs
  apis: ["./src/openapi/*.yaml"],
};

const swaggerSpec = swaggerJSDoc(swaggerOptions);

const app = express();

// Store the automation scheduler interval ID globally
let automationSchedulerInterval: NodeJS.Timeout | null = null;

// Middleware
app.use(compression()); // Enable gzip compression for all responses
app.use(cors()); // Configure specific origins in production
app.use(express.json()); // Parse JSON request bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded request bodies

// Swagger documentation
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// API Routes
app.use("/api", apiRoutes);

// Health check route
app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({ status: "UP", timestamp: new Date().toISOString() });
});

// Centralized Error Handling
app.use(errorHandler);

// 404 Handler for undefined routes
app.use((req: Request, res: Response, next: NextFunction) => {
  res
    .status(404)
    .json({ error: { message: "Resource not found on this server." } });
});

// Only start the server if this file is run directly
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  const httpServer = http.createServer(app);

  // Try to import and initialize socket.io if available
  try {
    const { Server } = require("socket.io");
    const io = new Server(httpServer, {
      cors: {
        origin: process.env.CLIENT_URL || "http://localhost:8100",
        methods: ["GET", "POST"],
      },
    });

    // Try to load socket manager if it exists
    try {
      const socketManager = require("./sockets/socket.manager");
      if (socketManager) {
        console.log("!!!!!!!!!! INITIALIZING SOCKET MANAGER NOW !!!!!!!!!!");
        socketManager(io);
      }
    } catch (error) {
      console.log("Socket manager not available or failed to initialize");
    }
  } catch (error) {
    console.log(
      "Socket.io not available, continuing without websocket support"
    );
  }

  httpServer.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Access at http://localhost:${PORT}`);

    // Start the automated fate pick scheduler
    try {
      automationSchedulerInterval =
        AIAutomationService.startAutomatedFatePickScheduler();
      console.log("🤖 AI Automation Service started successfully");
    } catch (error) {
      console.error("❌ Failed to start AI Automation Service:", error);
    }
  });
}

// Graceful shutdown handler
process.on("SIGTERM", () => {
  console.log("🛑 SIGTERM received, shutting down gracefully");
  if (automationSchedulerInterval) {
    AIAutomationService.stopAutomatedFatePickScheduler(
      automationSchedulerInterval
    );
  }
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("🛑 SIGINT received, shutting down gracefully");
  if (automationSchedulerInterval) {
    AIAutomationService.stopAutomatedFatePickScheduler(
      automationSchedulerInterval
    );
  }
  process.exit(0);
});

// Export the app for testing or for use in other files
export default app;
module.exports = app;
