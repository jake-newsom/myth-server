import jwt from "jsonwebtoken";
import config from "../config";
import UserModel from "../models/user.model";
import { Socket } from "socket.io";
import logger from "../utils/logger";
import { AuthenticatedSocket } from "../types/socket.types";

interface JwtPayload {
  userId: string;
  [key: string]: any;
}

/**
 * Middleware to authenticate socket connections for the presence namespace.
 * Validates JWT only (no gameId required). Use for /presence namespace.
 */
export const presenceAuthMiddleware = async (
  socket: Socket,
  next: (err?: Error) => void
): Promise<void> => {
  logger.debug("Attempting to authenticate presence socket connection", {
    socketId: socket.id,
    handshakeAuth: socket.handshake.auth,
  });

  const { token } = socket.handshake.auth;

  if (!token) {
    logger.warn("Presence socket authentication failed: No token provided", {
      socketId: socket.id,
    });
    return next(new Error("Authentication error: No token provided."));
  }

  try {
    if (!config.jwtSecret) {
      logger.error("JWT Secret not configured");
      return next(
        new Error("Authentication error: Server configuration issue")
      );
    }

    const decoded = jwt.verify(token, config.jwtSecret) as JwtPayload;
    logger.debug("JWT token verified successfully for presence", {
      socketId: socket.id,
      userId: decoded.userId,
    });

    if (!decoded || typeof decoded !== "object" || !decoded.userId) {
      logger.warn("Invalid JWT token payload format", {
        socketId: socket.id,
        decoded,
      });
      return next(new Error("Authentication error: Invalid token format"));
    }

    const userId = decoded.userId;
    const user = await UserModel.findById(userId);

    if (!user) {
      logger.warn("User not found during presence socket authentication", {
        socketId: socket.id,
        userId,
      });
      return next(new Error("Authentication error: User not found."));
    }

    logger.debug("Presence socket authenticated", {
      socketId: socket.id,
      userId,
      username: user.username,
    });

    (socket as AuthenticatedSocket).user = user;
    next();
  } catch (error) {
    logger.error(
      "Presence socket authentication failed",
      {
        socketId: socket.id,
      },
      error instanceof Error ? error : new Error(String(error))
    );

    return next(
      new Error("Authentication error: Invalid token or server error.")
    );
  }
};
