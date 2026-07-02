// myth-server/src/sockets/socket.manager.js
const { socketAuthMiddleware } = require("./socket.auth.middleware");
const { setupGameNamespace } = require("./namespace.game");
const { setupPresenceNamespace } = require("./namespace.presence");

/**
 * Initialize Socket.IO and set up the namespaced multiplayer layer.
 * @param {import('socket.io').Server} io - The Socket.IO server instance
 */
function initializeSocketManager(io) {
  io.use(socketAuthMiddleware); // Apply auth middleware to all incoming connections

  // Initialize the namespaced multiplayer layer
  setupGameNamespace(io);
  setupPresenceNamespace(io);

  console.log("Socket manager initialized (namespaced /game and /presence)");
}

module.exports = initializeSocketManager;
