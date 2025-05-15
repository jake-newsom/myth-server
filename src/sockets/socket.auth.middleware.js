const jwt = require("jsonwebtoken");
const config = require("../config").default; // Get the default export
const UserModel = require("../models/user.model").default; // Get the default export

/**
 * Middleware to authenticate socket connections using JWT
 * @param {import('socket.io').Socket} socket - The socket connection
 * @param {function(Error=): void} next - The next middleware function
 * @returns {Promise<void>}
 */
const socketAuthMiddleware = async (socket, next) => {
  // Client should send token in socket.handshake.auth object during connection
  // Example client-side: const socket = io({ auth: { token: "your_jwt_token" } });
  const token = socket.handshake.auth.token;

  if (!token) {
    console.log("Socket Auth: No token provided.");
    return next(new Error("Authentication error: No token provided."));
  }

  try {
    // Ensure jwtSecret is not undefined
    if (!config.jwtSecret) {
      console.error("JWT Secret is not defined in environment variables");
      return next(
        new Error("Authentication error: Server configuration issue")
      );
    }

    // Verify token
    const decoded = jwt.verify(token, config.jwtSecret);

    if (!decoded || typeof decoded !== "object" || !decoded.userId) {
      console.log("Invalid token payload:", decoded);
      return next(new Error("Authentication error: Invalid token format"));
    }

    const user = await UserModel.findById(decoded.userId);

    if (!user) {
      console.log(`Socket Auth: User ${decoded.userId} not found.`);
      return next(new Error("Authentication error: User not found."));
    }

    // Attach user object to the socket instance
    socket.user = user;
    next();
  } catch (error) {
    console.error(
      "Socket Auth Error:",
      error instanceof Error ? error.message : String(error)
    );
    return next(new Error("Authentication error: Invalid token."));
  }
};

module.exports = { socketAuthMiddleware };
