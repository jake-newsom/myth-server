const jwt = require("jsonwebtoken");
const config = require("../config").default;
const UserModel = require("../models/user.model").default;
const db = require("../config/db.config").default; // Import database

/**
 * Middleware to authenticate socket connections using JWT and authorize for a game room.
 * @param {import('socket.io').Socket} socket - The socket connection
 * @param {function(Error=): void} next - The next middleware function
 * @returns {Promise<void>}
 */
const socketAuthMiddleware = async (socket, next) => {
  console.log(
    "[Socket Auth] Attempting to authenticate and authorize a new connection..."
  );
  console.log(
    "[Socket Auth] Received handshake auth object:",
    socket.handshake.auth
  );
  const { token, gameId } = socket.handshake.auth;

  if (!token) {
    console.log("[Socket Auth] FAILED: No token provided.");
    return next(new Error("Authentication error: No token provided."));
  }
  if (!gameId) {
    console.log("[Socket Auth] FAILED: No gameId provided.");
    return next(new Error("Authorization error: gameId is required."));
  }
  console.log(`[Socket Auth] Token received: ${token.substring(0, 30)}...`);
  console.log(`[Socket Auth] Attempting to join gameId: ${gameId}`);

  try {
    if (!config.jwtSecret) {
      console.error(
        "[Socket Auth] FATAL: JWT Secret is not defined in environment variables"
      );
      return next(
        new Error("Authentication error: Server configuration issue")
      );
    }
    console.log("[Socket Auth] JWT secret found. Verifying token...");

    const decoded = jwt.verify(token, config.jwtSecret);
    console.log("[Socket Auth] Token decoded successfully:", decoded);

    if (!decoded || typeof decoded !== "object" || !decoded.userId) {
      console.log(
        "[Socket Auth] FAILED: Invalid token payload format.",
        decoded
      );
      return next(new Error("Authentication error: Invalid token format"));
    }

    const userId = decoded.userId;
    console.log(`[Socket Auth] Finding user by ID: ${userId}`);
    const user = await UserModel.findById(userId);

    if (!user) {
      console.log(`[Socket Auth] FAILED: User ${userId} not found.`);
      return next(new Error("Authentication error: User not found."));
    }

    console.log(
      `[Socket Auth] User ${user.username} authenticated. Authorizing for game...`
    );

    // --- Game Authorization ---
    const gameResult = await db.query(
      'SELECT player1_id, player2_id FROM "games" WHERE game_id = $1',
      [gameId]
    );

    if (gameResult.rows.length === 0) {
      console.log(`[Socket Auth] FAILED: Game ${gameId} not found.`);
      return next(new Error("Authorization error: Game not found."));
    }

    const game = gameResult.rows[0];
    console.log(
      `[Socket Auth] Game found. Player 1 ID: ${game.player1_id}, Player 2 ID: ${game.player2_id}`
    );

    const isAuthorized =
      game.player1_id === userId || game.player2_id === userId;
    console.log(
      `[Socket Auth] Verifying authorization... Is user an authorized player? ${isAuthorized}`
    );

    if (!isAuthorized) {
      console.log(
        `[Socket Auth] FAILED: User ${userId} is not a participant in game ${gameId}.`
      );
      return next(
        new Error("Authorization error: You are not a player in this game.")
      );
    }

    console.log(
      `[Socket Auth] SUCCESS: User ${user.username} authorized for game ${gameId}.`
    );

    // Attach user object to the socket instance for later use
    socket.user = user;
    next();
  } catch (error) {
    console.error(
      "[Socket Auth] FAILED: An error occurred during authentication/authorization.",
      error instanceof Error ? error.message : String(error)
    );
    return next(
      new Error("Authentication error: Invalid token or server error.")
    );
  }
};

module.exports = { socketAuthMiddleware };
