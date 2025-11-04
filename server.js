// myth-server/server.js
require("dotenv").config(); // Load environment variables first
const http = require("http");
const app = require("./dist/app"); // Import the Express app from the dist directory
const { Server } = require("socket.io"); // Import Socket.IO Server
const initializeSocketManager = require("./dist/sockets/socket.manager"); // Socket.IO manager from dist

const PORT = process.env.PORT || 3000;

const httpServer = http.createServer(app);

// Initialize Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:8100", // Adjust for your client URL (Ionic default)
    methods: ["GET", "POST"],
    // credentials: true // If you need to send cookies with socket requests (not typical for token auth)
  },
});

initializeSocketManager(io); // Pass the 'io' instance to your socket manager

// Store the automation scheduler interval IDs
let automationSchedulerInterval = null;
let dailyRewardsSchedulerInterval = null;

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
  process.exit(0);
});
