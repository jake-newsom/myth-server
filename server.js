// myth-server/server.js
require("dotenv").config(); // Load environment variables first
const http = require("http");
const app = require("./dist/app"); // Import the Express app from the dist directory
const { Server } = require("socket.io"); // Import Socket.IO Server
const initializeSocketManager = require("./dist/sockets/socket.manager"); // Socket.IO manager from dist

const PORT = process.env.PORT || 3000;

const httpServer = http.createServer(app);

// CORS configuration supporting mobile apps (Capacitor/Cordova)
const allowedOrigins = [
  process.env.CLIENT_URL,
  "http://localhost:8100", // Local dev
  "https://localhost", // Capacitor Android
  "capacitor://localhost", // Capacitor iOS
  "ionic://localhost", // Ionic webview
].filter(Boolean); // Remove undefined values

// Initialize Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) return callback(null, true);
      
      // Check if origin is in allowed list
      if (allowedOrigins.some(allowed => origin.startsWith(allowed))) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
});

initializeSocketManager(io); // Pass the 'io' instance to your socket manager

// Store the automation scheduler interval IDs
let automationSchedulerInterval = null;
let dailyRewardsSchedulerInterval = null;
let seasonMaintenanceScheduler = null;

httpServer.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Socket.IO initialized and listening.`);
  console.log(`Access at http://localhost:${PORT}`);
  
  // Run startup initialization
  try {
    const StartupService = require("./dist/services/startup.service").default;
    await StartupService.initialize();
  } catch (error) {
    console.error("❌ Startup initialization failed:", error);
  }

  // Initialize season system and ensure season buffer on startup
  try {
    const SeasonService = require("./dist/services/season.service").default;
    const SeasonSoulsService =
      require("./dist/services/seasonSouls.service").default;

    await SeasonService.initialize();
    seasonMaintenanceScheduler = SeasonService.startMaintenanceScheduler();
    SeasonSoulsService.start();
    console.log("🏁 Season Services started successfully");
  } catch (error) {
    console.error("❌ Failed to start Season Services:", error);
  }
  
  // Start the automated fate pick scheduler
  try {
    const AIAutomationService = require("./dist/services/aiAutomation.service").default;
    automationSchedulerInterval = AIAutomationService.startAutomatedFatePickScheduler();
    console.log("🤖 AI Automation Service started successfully");
  } catch (error) {
    console.error("❌ Failed to start AI Automation Service:", error);
  }

  // Start the daily rewards scheduler
  try {
    const DailyRewardsService = require("./dist/services/dailyRewards.service").default;
    dailyRewardsSchedulerInterval = DailyRewardsService.startDailyRewardsScheduler();
    console.log("🎁 Daily Rewards Service started successfully");
  } catch (error) {
    console.error("❌ Failed to start Daily Rewards Service:", error);
  }
});

// Graceful shutdown handler
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  if (automationSchedulerInterval) {
    const AIAutomationService = require("./dist/services/aiAutomation.service").default;
    AIAutomationService.stopAutomatedFatePickScheduler(automationSchedulerInterval);
  }
  if (dailyRewardsSchedulerInterval) {
    const DailyRewardsService = require("./dist/services/dailyRewards.service").default;
    DailyRewardsService.stopDailyRewardsScheduler(dailyRewardsSchedulerInterval);
  }
  if (seasonMaintenanceScheduler) {
    const SeasonService = require("./dist/services/season.service").default;
    SeasonService.stopMaintenanceScheduler(seasonMaintenanceScheduler);
  }
  try {
    const SeasonSoulsService =
      require("./dist/services/seasonSouls.service").default;
    SeasonSoulsService.flushNow().catch(() => {});
    SeasonSoulsService.stop();
  } catch (error) {
    console.error("⚠️ Failed to stop Season Souls Service:", error);
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully');
  if (automationSchedulerInterval) {
    const AIAutomationService = require("./dist/services/aiAutomation.service").default;
    AIAutomationService.stopAutomatedFatePickScheduler(automationSchedulerInterval);
  }
  if (dailyRewardsSchedulerInterval) {
    const DailyRewardsService = require("./dist/services/dailyRewards.service").default;
    DailyRewardsService.stopDailyRewardsScheduler(dailyRewardsSchedulerInterval);
  }
  if (seasonMaintenanceScheduler) {
    const SeasonService = require("./dist/services/season.service").default;
    SeasonService.stopMaintenanceScheduler(seasonMaintenanceScheduler);
  }
  try {
    const SeasonSoulsService =
      require("./dist/services/seasonSouls.service").default;
    SeasonSoulsService.flushNow().catch(() => {});
    SeasonSoulsService.stop();
  } catch (error) {
    console.error("⚠️ Failed to stop Season Souls Service:", error);
  }
  process.exit(0);
});
