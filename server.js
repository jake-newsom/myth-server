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

// Store the automation scheduler interval ID
let automationSchedulerInterval = null;

httpServer.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Socket.IO initialized and listening.`);
  console.log(`Access at http://localhost:${PORT}`);
  
  // Start the automated fate pick scheduler
  try {
    const AIAutomationService = require("./dist/services/aiAutomation.service").default;
    automationSchedulerInterval = AIAutomationService.startAutomatedFatePickScheduler();
    console.log("🤖 AI Automation Service started successfully");
  } catch (error) {
    console.error("❌ Failed to start AI Automation Service:", error);
  }
});

// Graceful shutdown handler
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  if (automationSchedulerInterval) {
    const AIAutomationService = require("./dist/services/aiAutomation.service").default;
    AIAutomationService.stopAutomatedFatePickScheduler(automationSchedulerInterval);
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully');
  if (automationSchedulerInterval) {
    const AIAutomationService = require("./dist/services/aiAutomation.service").default;
    AIAutomationService.stopAutomatedFatePickScheduler(automationSchedulerInterval);
  }
  process.exit(0);
});
