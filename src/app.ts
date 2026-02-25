import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import compression from "compression";
import swaggerJSDoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import fs from "fs";
import path from "path";
import http from "http";
import dotenv from "dotenv";
import { marked } from "marked";
import * as cron from "node-cron";

// Load environment variables
dotenv.config();

// Load version from package.json
const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../package.json"), "utf8")
);
const SERVER_VERSION = packageJson.version;

// Import the API routes
import apiRoutes from "./api/routes";
import errorHandler from "./api/middlewares/errorHandler.middleware";
import AIAutomationService from "./services/aiAutomation.service";
import SessionCleanupService from "./services/sessionCleanup.service";
import DailyRewardsService from "./services/dailyRewards.service";
import DailyTaskService from "./services/dailyTask.service";
import StartupService from "./services/startup.service";
import { redisCache } from "./services/redis.cache.service";

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

// Store the automation scheduler tasks globally
let automationSchedulerTask: any = null;
let dailyRewardsSchedulerTasks: any[] = [];
let dailyTaskScheduler: any = null;

// Middleware
app.use(compression()); // Enable gzip compression for all responses

// CORS configuration supporting mobile apps (Capacitor/Cordova)
const allowedOrigins: string[] = [
  process.env.CLIENT_URL,
  "http://localhost:8100", // Local dev
  "https://localhost", // Capacitor Android
  "capacitor://localhost", // Capacitor iOS
  "ionic://localhost", // Ionic webview
].filter((origin): origin is string => Boolean(origin)); // Remove undefined values

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) return callback(null, true);

      // Check if origin is in allowed list
      if (allowedOrigins.some((allowed) => origin.startsWith(allowed))) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    exposedHeaders: ["X-Server-Version"], // Allow client to read custom headers
    allowedHeaders: ["Content-Type", "Authorization"],
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  })
);
app.use(express.json()); // Parse JSON request bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded request bodies

// Add server version to all responses
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader("X-Server-Version", SERVER_VERSION);
  next();
});

// Swagger documentation
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Static assets (images, etc.)
app.use("/assets", express.static(path.join(__dirname, "../content/assets")));

// API Routes
app.use("/api", apiRoutes);

// Health check route
app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({ status: "UP", timestamp: new Date().toISOString() });
});

// Home page
app.get(["/", "/index.html"], (req: Request, res: Response) => {
  try {
    const htmlPath = path.join(__dirname, "../content/index.html");
    const htmlContent = fs.readFileSync(htmlPath, "utf8");
    res.type("html").send(htmlContent);
  } catch (error) {
    res.status(500).send("Error loading page");
  }
});

// Helper function to render markdown as HTML
const renderMarkdownPage = (title: string, markdownContent: string): string => {
  const htmlContent = marked(markdownContent);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Myth</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      line-height: 1.6;
      max-width: 800px;
      margin: 0 auto;
      padding: 2rem;
      color: #333;
      background-color: #fafafa;
    }
    h1, h2, h3 { color: #1a1a1a; }
    h1 { border-bottom: 2px solid #eee; padding-bottom: 0.5rem; }
    a { color: #0066cc; }
    code { background: #f4f4f4; padding: 0.2em 0.4em; border-radius: 3px; }
    pre { background: #f4f4f4; padding: 1rem; border-radius: 5px; overflow-x: auto; }
    blockquote { border-left: 4px solid #ddd; margin: 0; padding-left: 1rem; color: #666; }
  </style>
</head>
<body>
  ${htmlContent}
</body>
</html>`;
};

// Privacy Policy page
app.get(["/privacy", "/privacy-policy"], (req: Request, res: Response) => {
  try {
    const markdownPath = path.join(__dirname, "../content/privacy.md");
    const markdownContent = fs.readFileSync(markdownPath, "utf8");
    const html = renderMarkdownPage("Privacy Policy", markdownContent);
    res.type("html").send(html);
  } catch (error) {
    res.status(500).send("Error loading privacy policy");
  }
});

// Terms of Service page
app.get("/terms", (req: Request, res: Response) => {
  try {
    const markdownPath = path.join(__dirname, "../content/terms.md");
    const markdownContent = fs.readFileSync(markdownPath, "utf8");
    const html = renderMarkdownPage("Terms of Service", markdownContent);
    res.type("html").send(html);
  } catch (error) {
    res.status(500).send("Error loading terms of service");
  }
});

// Delete Account Instructions page
app.get("/docs/delete-account", (req: Request, res: Response) => {
  try {
    const markdownPath = path.join(__dirname, "../content/delete-account.md");
    const markdownContent = fs.readFileSync(markdownPath, "utf8");
    const html = renderMarkdownPage("Delete Account", markdownContent);
    res.type("html").send(html);
  } catch (error) {
    res.status(500).send("Error loading delete account instructions");
  }
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
        origin: (origin: string, callback: any) => {
          // Allow requests with no origin (mobile apps)
          if (!origin) return callback(null, true);

          // Check if origin is in allowed list
          if (allowedOrigins.some((allowed) => origin.startsWith(allowed))) {
            callback(null, true);
          } else {
            callback(new Error("Not allowed by CORS"));
          }
        },
        methods: ["GET", "POST"],
        credentials: true,
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

  httpServer.listen(PORT, async () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Access at http://localhost:${PORT}`);

    // Initialize Redis cache
    try {
      await redisCache.connect();
      console.log("✅ Redis cache connected successfully");

      // Purge all cached data on startup to ensure fresh data after schema changes
      const cleared = await redisCache.clear();
      if (cleared) {
        console.log("🧹 Redis cache purged on startup");
      }
    } catch (error) {
      console.error(
        "⚠️  Redis cache connection failed (continuing without cache):",
        error
      );
    }

    // Run startup initialization
    try {
      await StartupService.initialize();
    } catch (error) {
      console.error("❌ Startup initialization failed:", error);
    }

    // Start the automated fate pick scheduler
    try {
      automationSchedulerTask =
        AIAutomationService.startAutomatedFatePickScheduler();
      console.log("🤖 AI Automation Service started successfully");
    } catch (error) {
      console.error("❌ Failed to start AI Automation Service:", error);
    }

    // Start the session cleanup service
    try {
      SessionCleanupService.start();
      console.log("🧹 Session Cleanup Service started successfully");
    } catch (error) {
      console.error("❌ Failed to start Session Cleanup Service:", error);
    }

    // Start the daily rewards and shop service
    try {
      dailyRewardsSchedulerTasks =
        DailyRewardsService.startDailyRewardsScheduler();
      console.log("🎁 Daily Rewards and Shop Service started successfully");
    } catch (error) {
      console.error(
        "❌ Failed to start Daily Rewards and Shop Service:",
        error
      );
    }

    // Start the daily task scheduler (runs at 12am UTC to select tomorrow's tasks)
    try {
      // Ensure today's selection exists on startup
      await DailyTaskService.ensureTodaySelection();

      // Schedule daily task selection at 12am UTC
      dailyTaskScheduler = cron.schedule(
        "0 0 * * *",
        async () => {
          console.log("🎯 Running daily task selection scheduler...");
          await DailyTaskService.generateTomorrowSelection();
        },
        {
          timezone: "UTC",
        }
      );
      console.log("🎯 Daily Task Scheduler started successfully");
    } catch (error) {
      console.error("❌ Failed to start Daily Task Scheduler:", error);
    }
  });
}

// Graceful shutdown handler
process.on("SIGTERM", async () => {
  console.log("🛑 SIGTERM received, shutting down gracefully");
  if (automationSchedulerTask) {
    AIAutomationService.stopAutomatedFatePickScheduler(automationSchedulerTask);
  }
  if (dailyRewardsSchedulerTasks.length > 0) {
    DailyRewardsService.stopDailyRewardsScheduler(dailyRewardsSchedulerTasks);
  }
  if (dailyTaskScheduler) {
    dailyTaskScheduler.stop();
    console.log("🎯 Daily Task Scheduler stopped");
  }
  SessionCleanupService.stop();
  await redisCache.disconnect();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("🛑 SIGINT received, shutting down gracefully");
  if (automationSchedulerTask) {
    AIAutomationService.stopAutomatedFatePickScheduler(automationSchedulerTask);
  }
  if (dailyRewardsSchedulerTasks.length > 0) {
    DailyRewardsService.stopDailyRewardsScheduler(dailyRewardsSchedulerTasks);
  }
  if (dailyTaskScheduler) {
    dailyTaskScheduler.stop();
    console.log("🎯 Daily Task Scheduler stopped");
  }
  SessionCleanupService.stop();
  await redisCache.disconnect();
  process.exit(0);
});

// Export the app for testing or for use in other files
export default app;
module.exports = app;
