// myth-server/src/sockets/socket.manager.js
const { socketAuthMiddleware } = require("./socket.auth.middleware");
const { setupGameNamespace } = require("./namespace.game");
const { setupPresenceNamespace } = require("./namespace.presence");
const { captureServerException } = require("../utils/telemetry");

/**
 * Wrap every listener a socket registers so a throw or a rejected promise in a
 * socket handler is reported to PostHog (socket handlers never pass through
 * Express's errorHandler). The error is logged and swallowed rather than left
 * to crash the process as an unhandled rejection.
 */
function instrumentSocket(socket, namespace) {
  if (socket.__telemetryWrapped) return;
  socket.__telemetryWrapped = true;
  const originalOn = socket.on.bind(socket);
  socket.on = (event, listener) => {
    if (typeof listener !== "function") return originalOn(event, listener);
    const report = (error) => {
      console.error(`[socket ${namespace}] handler "${event}" failed:`, error);
      captureServerException(error, {
        distinctId: socket.data?.userId || socket.userId || socket.user?.user_id,
        handler_type: "socket",
        namespace,
        socket_event: event,
      });
    };
    return originalOn(event, function wrappedListener(...args) {
      try {
        const result = listener.apply(this, args);
        if (result && typeof result.catch === "function") result.catch(report);
        return result;
      } catch (error) {
        report(error);
      }
    });
  };
}

/**
 * Initialize Socket.IO and set up the namespaced multiplayer layer.
 * @param {import('socket.io').Server} io - The Socket.IO server instance
 */
function initializeSocketManager(io) {
  io.use(socketAuthMiddleware); // Apply auth middleware to all incoming connections

  // Instrument before any connection handler attaches listeners. Namespace
  // middleware runs before that namespace's "connection" event.
  for (const name of ["/", "/game", "/presence"]) {
    io.of(name).use((socket, next) => {
      instrumentSocket(socket, name);
      next();
    });
  }

  // Initialize the namespaced multiplayer layer
  setupGameNamespace(io);
  setupPresenceNamespace(io);

  console.log("Socket manager initialized (namespaced /game and /presence)");
}

module.exports = initializeSocketManager;
