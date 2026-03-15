import { Namespace, Server, Socket } from "socket.io";
import { presenceAuthMiddleware } from "./presence.auth.middleware";
import { AuthenticatedSocket } from "../types/socket.types";
import {
  PresenceNamespaceEvent,
  PresencePlayerCountPayload,
} from "../types/socket.types";
import logger from "../utils/logger";

/**
 * Set up the `/presence` Socket.IO namespace. Tracks unique connected users
 * and broadcasts the live player count to all clients when anyone connects or disconnects.
 * Uses JWT-only auth (no gameId required) so clients can connect when they open the game.
 *
 * @param io The root Socket.IO server instance
 */
export function setupPresenceNamespace(io: Server): void {
  const presenceNs: Namespace = io.of("/presence");
  presenceNs.use((socket, next) => presenceAuthMiddleware(socket as any, next));

  // userId -> Set of socketIds (one user can have multiple tabs/devices; we count unique users)
  const userSocketsMap = new Map<string, Set<string>>();

  function getUniqueUserCount(): number {
    return userSocketsMap.size;
  }

  function broadcastPlayerCount(): void {
    const count = getUniqueUserCount();
    const payload: PresencePlayerCountPayload = { count };
    presenceNs.emit(PresenceNamespaceEvent.SERVER_PLAYER_COUNT, payload);
    logger.debug("Presence: broadcast player count", { count });
  }

  presenceNs.on("connection", (socket: Socket) => {
    const authedSocket = socket as AuthenticatedSocket;
    const userId = authedSocket.user.user_id;

    let socketsForUser = userSocketsMap.get(userId);
    if (!socketsForUser) {
      socketsForUser = new Set<string>();
      userSocketsMap.set(userId, socketsForUser);
    }
    socketsForUser.add(socket.id);

    logger.debug("[/presence] Connected", {
      userId,
      socketId: socket.id,
      uniqueUsers: getUniqueUserCount(),
    });

    // Send current count to this socket immediately
    socket.emit(PresenceNamespaceEvent.SERVER_PLAYER_COUNT, {
      count: getUniqueUserCount(),
    } as PresencePlayerCountPayload);

    // Notify all clients (including this one) that count may have changed
    broadcastPlayerCount();

    socket.on("disconnect", (reason) => {
      logger.debug("[/presence] Disconnect", {
        userId,
        socketId: socket.id,
        reason,
      });

      const socketsForUserAfter = userSocketsMap.get(userId);
      if (socketsForUserAfter) {
        socketsForUserAfter.delete(socket.id);
        if (socketsForUserAfter.size === 0) {
          userSocketsMap.delete(userId);
        }
      }

      broadcastPlayerCount();
    });
  });

  logger.info("Presence namespace (/presence) initialized");
}
