import UserModel from "../models/user.model";
import db from "../config/db.config";
import { Socket } from "socket.io";
import logger from "../utils/logger";
import { AuthenticatedSocket } from "../types/socket.types";
import SessionService from "../services/session.service";

/**
 * Middleware to authenticate socket connections using JWT and authorize for a game room.
 */
export const socketAuthMiddleware = async (
  socket: Socket,
  next: (err?: Error) => void
): Promise<void> => {
  logger.debug("Attempting to authenticate socket connection", {
    socketId: socket.id,
    handshakeAuth: socket.handshake.auth,
  });

  const { token, gameId } = socket.handshake.auth;

  if (!token) {
    logger.warn("Socket authentication failed: No token provided", {
      socketId: socket.id,
    });
    return next(new Error("Authentication error: No token provided."));
  }

  if (!gameId) {
    logger.warn("Socket authentication failed: No gameId provided", {
      socketId: socket.id,
    });
    return next(new Error("Authorization error: gameId is required."));
  }

  try {
    const session = await SessionService.validateAccessToken(token);

    if (!session) {
      logger.warn("Socket authentication failed: invalid or revoked token", {
        socketId: socket.id,
      });
      return next(new Error("Authentication error: Invalid or expired token."));
    }

    logger.debug("JWT token verified successfully", {
      socketId: socket.id,
      userId: session.user_id,
    });

    const userId = session.user_id;
    const user = await UserModel.findById(userId);

    if (!user) {
      logger.warn("User not found during socket authentication", {
        socketId: socket.id,
        userId,
      });
      return next(new Error("Authentication error: User not found."));
    }

    logger.debug("User authenticated, checking game authorization", {
      socketId: socket.id,
      userId,
      username: user.username,
      gameId,
    });

    // Game Authorization
    const gameResult = await db.query(
      'SELECT player1_id, player2_id FROM "games" WHERE game_id = $1',
      [gameId]
    );

    if (gameResult.rows.length === 0) {
      logger.warn("Game not found during socket authorization", {
        socketId: socket.id,
        userId,
        gameId,
      });
      return next(new Error("Authorization error: Game not found."));
    }

    const game = gameResult.rows[0];
    const isAuthorized =
      game.player1_id === userId || game.player2_id === userId;

    if (!isAuthorized) {
      logger.warn("User not authorized for game", {
        socketId: socket.id,
        userId,
        gameId,
        player1Id: game.player1_id,
        player2Id: game.player2_id,
      });
      return next(
        new Error("Authorization error: You are not a player in this game.")
      );
    }

    logger.info("Socket authentication and authorization successful", {
      socketId: socket.id,
      userId,
      username: user.username,
      gameId,
    });

    // Attach user object to the socket instance for later use
    (socket as AuthenticatedSocket).user = user;
    next();
  } catch (error) {
    logger.error(
      "Socket authentication failed",
      {
        socketId: socket.id,
        gameId,
      },
      error instanceof Error ? error : new Error(String(error))
    );

    return next(
      new Error("Authentication error: Invalid token or server error.")
    );
  }
};
