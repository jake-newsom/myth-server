import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import compression from "compression";
import helmet from "helmet";
import swaggerJSDoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import fs from "fs";
import path from "path";
import http from "http";
import dotenv from "dotenv";
import { marked } from "marked";

// Load environment variables
dotenv.config();

import { validateConfig } from "./config/validateConfig";
validateConfig();

import { validateIapConfig } from './config/iap.config';
validateIapConfig();

// Load version from package.json
const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"),
);
const SERVER_VERSION = packageJson.version;

// Import the API routes
import apiRoutes from "./api/routes";
import errorHandler from "./api/middlewares/errorHandler.middleware";
import {
  startBackgroundJobs,
  stopBackgroundJobs,
} from "./services/backgroundJobs";
import { redisCache } from "./services/redis.cache.service";
import {
  captureServerException,
  clientReleaseProps,
  installProcessErrorHandlers,
  shutdownTelemetry,
} from "./utils/telemetry";

installProcessErrorHandlers();
import { queryMetricsMiddleware } from "./utils/queryMetrics";

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

// Trust the first proxy hop (Render's load balancer) so req.ip / X-Forwarded-*
// unwind that hop.
//
// NOTE: Cloudflare sits in front of Render, so this single hop is NOT enough to
// reach the real client — req.ip resolves to the Cloudflare edge node
// (104.22.x / 104.23.x). Deliberately left at 1: widening it would let a client
// forge X-Forwarded-For and pick its own identity. Anything that needs the real
// client IP must use getClientIp() (utils/clientIp.ts), which prefers the
// Cloudflare-set CF-Connecting-IP header.
app.set("trust proxy", 1);

// Middleware
app.use(compression()); // Enable gzip compression for all responses

// Security headers. CSP is intentionally disabled for now because the markdown
// content pages render inline <style> blocks; we'll add a route-scoped CSP
// later. Other helmet protections (HSTS, X-Frame-Options, X-Content-Type-Options,
// Referrer-Policy, etc.) are still applied.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

// CORS configuration supporting mobile apps (Capacitor/Cordova).
// Exact-match origins only — substring/prefix matching is unsafe because
// e.g. "https://localhost.evil.com" would have matched "https://localhost".
const allowedOrigins = new Set<string>(
  [
    process.env.CLIENT_URL, // Production web client (e.g. https://cardsofmyth.com)
    "https://cardsofmyth.com",
    "https://www.cardsofmyth.com",
    "https://myth-server.onrender.com",
    "http://localhost:8100", // Local dev
    "https://localhost:8100", // Local dev (Ionic/SSL)
    "http://localhost:3000", // Local dev (alt port)
    "https://localhost", // Capacitor Android (no hostname configured)
    "capacitor://localhost", // Capacitor iOS (no hostname configured)
    "ionic://localhost", // Ionic webview
    // Capacitor with hostname configured in capacitor.config.ts. iOS WKWebView
    // uses the `capacitor://` scheme regardless of `iosScheme: "https"`, so we
    // need both the https and capacitor variants of the configured hostname.
    "capacitor://cardsofmyth.com",
    "capacitor://www.cardsofmyth.com",
  ].filter((origin): origin is string => Boolean(origin)),
);

const corsOriginCheck = (
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
) => {
  // Allow requests with no Origin header (native mobile apps, Postman, server-side calls).
  if (!origin) return callback(null, true);

  if (allowedOrigins.has(origin)) {
    return callback(null, true);
  }
  console.warn(`[CORS] Rejected origin: ${origin}`);
  return callback(new Error(`Not allowed by CORS: ${origin}`));
};

app.use(
  cors({
    origin: corsOriginCheck,
    credentials: true,
    exposedHeaders: ["X-Server-Version"], // Allow client to read custom headers
    allowedHeaders: ["Content-Type", "Authorization", "X-Client-Version"],
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  }),
);
// Many legacy controllers answer 500 themselves instead of throwing (see
// ERROR_HANDLING_TODO.md), so errorHandler never sees them. Report those too.
app.use((req: Request, res: Response, next: NextFunction) => {
  res.on("finish", () => {
    if (res.statusCode < 500 || res.locals.errorReported) return;
    const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path;
    captureServerException(
      new Error(`HTTP ${res.statusCode} ${req.method} ${route}`),
      {
        distinctId: (req as any).user?.user_id,
        handler_type: "http_unthrown",
        route,
        method: req.method,
        http_status: res.statusCode,
        ...clientReleaseProps(req.headers),
      },
    );
  });
  next();
});
app.use(express.json({ limit: "1mb" })); // Parse JSON request bodies
app.use(express.urlencoded({ extended: true, limit: "1mb" })); // Parse URL-encoded request bodies
app.use(queryMetricsMiddleware);

// Add server version to all responses
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader("X-Server-Version", SERVER_VERSION);
  next();
});

// Swagger documentation
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Assets (card images, patch ZIPs) are now stored in Cloudflare R2 and served
// via the worker at assets.cardsofmyth.com with signed URLs.
// The manifest endpoint (/api/asset-patches/manifest) returns signed download
// URLs so clients never hit this server for binary assets.

// Static assets for content pages (e.g. /assets/logo.png → content/assets/logo.png)
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
        origin: corsOriginCheck,
        methods: ["GET", "POST"],
        credentials: true,
      },
    });

    // Make the Socket.IO server reachable from HTTP controllers via
    // `req.app.get("io")`. This lets routes (e.g. matchmaking) push events
    // to connected clients without needing a circular dependency on the
    // socket manager module.
    app.set("io", io);

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
      "Socket.io not available, continuing without websocket support",
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
        error,
      );
    }

    // Every scheduler and cron, shared with server.js (prod).
    await startBackgroundJobs();
  });
}

// Graceful shutdown. Registered at import time, so it also covers server.js
// (prod), which imports this module.
async function shutdown(signal: string) {
  console.log(`🛑 ${signal} received, shutting down gracefully`);
  await stopBackgroundJobs();
  try {
    await redisCache.disconnect();
  } catch {
    // Not connected (prod entrypoint never connects); nothing to close.
  }
  await shutdownTelemetry();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// Export the app for testing or for use in other files
export default app;
module.exports = app;
