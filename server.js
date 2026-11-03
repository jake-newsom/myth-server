// myth-server/server.js
require("dotenv").config(); // Load environment variables first
const http = require("http");
const app = require("./dist/app"); // Import the Express app from the dist directory
const { Server } = require("socket.io"); // Import Socket.IO Server
const initializeSocketManager = require("./dist/sockets/socket.manager"); // Socket.IO manager from dist

const PORT = process.env.PORT || 3000;

const httpServer = http.createServer(app);

// CORS configuration supporting mobile apps (Capacitor/Cordova).
// Exact-match origins only — substring/prefix matching is unsafe.
const allowedOrigins = new Set(
  [
    process.env.CLIENT_URL, // Production web client
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
  ].filter(Boolean),
);

// Initialize Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      // Allow requests with no origin (native mobile apps, Postman).
      if (!origin) return callback(null, true);

      if (allowedOrigins.has(origin)) {
        return callback(null, true);
      }
      console.warn(`[CORS] Rejected origin: ${origin}`);
      return callback(new Error(`Not allowed by CORS: ${origin}`));
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
});

initializeSocketManager(io); // Pass the 'io' instance to your socket manager

// Make the Socket.IO server reachable from HTTP controllers via
// `req.app.get("io")`. The dev entrypoint (ts-node src/app.ts) sets this
// inside app.ts's `require.main === module` block, but in production the
// entrypoint is THIS file — app.ts is only imported, so that block never
// runs. Without this line, ChallengeController.attachPresenceEmitter() can't
// find `io`, the challenge presence emitter is never set, and every
// challenge:incoming / accepted / ready emit is a silent no-op (no popup).
app.set("io", io);

httpServer.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Socket.IO initialized and listening.`);
  console.log(`Access at http://localhost:${PORT}`);

  // Every scheduler and cron lives in one shared starter that the dev
  // entrypoint (src/app.ts) calls too, so the two lists can't drift again.
  // SIGTERM/SIGINT are handled by dist/app (registered when it's imported):
  // they stop these jobs, flush Season Souls and PostHog, then exit.
  const { startBackgroundJobs } = require("./dist/services/backgroundJobs");
  await startBackgroundJobs();
});
