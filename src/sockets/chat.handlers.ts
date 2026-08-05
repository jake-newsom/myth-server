import { Socket } from "socket.io";
import { AuthenticatedSocket } from "../types/socket.types";
import {
  ChatError,
  ChatSendPayload,
  ChatShareCardPayload,
  ChatSocketEvent,
  ChatSubscribePayload,
  ClientChatChannel,
} from "../types/chat.types";
import chatService from "../services/chat.service";
import logger from "../utils/logger";

/**
 * Chat event handlers, registered on an existing `/presence` socket.
 *
 * Chat deliberately rides the presence namespace rather than opening its own
 * connection: a second socket on mobile would double the reconnect surface
 * that presence already had to be hardened against.
 */

const CLIENT_CHANNELS: readonly ClientChatChannel[] = ["global", "guild"];

function isClientChannel(value: unknown): value is ClientChatChannel {
  return (
    typeof value === "string" &&
    CLIENT_CHANNELS.includes(value as ClientChatChannel)
  );
}

/**
 * Translate a thrown error into a single `chat:error` frame for the offending
 * socket only. Unexpected errors are logged and reported generically rather
 * than leaking internals to the client.
 */
function emitError(socket: Socket, error: unknown, context: string): void {
  if (error instanceof ChatError) {
    socket.emit(ChatSocketEvent.SERVER_ERROR, {
      code: error.code,
      message: error.message,
    });
    return;
  }

  logger.error(
    `[chat] ${context} failed`,
    { socketId: socket.id },
    error instanceof Error ? error : new Error(String(error))
  );

  socket.emit(ChatSocketEvent.SERVER_ERROR, {
    code: "server_error",
    message: "Something went wrong. Please try again.",
  });
}

/**
 * Register chat listeners on a freshly connected, already-authenticated
 * presence socket.
 */
export function registerChatHandlers(socket: AuthenticatedSocket): void {
  const userId = socket.user.user_id;

  // Stash the user id on socket.data so the per-viewer split emit can resolve
  // a socket back to its filter preference without a lookup map.
  socket.data.userId = userId;

  // Warm the user-state cache (filter preference + mute) so the send path
  // never touches the DB for these, then auto-subscribe. Auto-subscribing
  // means a client needs no round trip before it starts receiving.
  void (async () => {
    try {
      await chatService.loadUserState(userId);
      await chatService.subscribeSocket(socket, ["global", "guild"]);
    } catch (error) {
      logger.error(
        "[chat] Auto-subscribe failed",
        { userId, socketId: socket.id },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  })();

  socket.on(
    ChatSocketEvent.CLIENT_SUBSCRIBE,
    (payload: ChatSubscribePayload) => {
      void (async () => {
        try {
          const requested = Array.isArray(payload?.channels)
            ? payload.channels.filter(isClientChannel)
            : [...CLIENT_CHANNELS];
          // Warm the filter/mute cache BEFORE joining any room. Joining first
          // would put this socket in range of a broadcast while its
          // preference is still unknown.
          await chatService.loadUserState(userId);
          // Unentitled channels are skipped silently inside subscribeSocket,
          // so a guildless client can ask for both without special-casing.
          await chatService.subscribeSocket(socket, requested);
        } catch (error) {
          emitError(socket, error, "subscribe");
        }
      })();
    }
  );

  socket.on(ChatSocketEvent.CLIENT_SEND, (payload: ChatSendPayload) => {
    void (async () => {
      try {
        const channel = isClientChannel(payload?.channel)
          ? payload.channel
          : "global";
        await chatService.sendTextMessage(socket, channel, payload?.body);
      } catch (error) {
        emitError(socket, error, "send");
      }
    })();
  });

  socket.on(
    ChatSocketEvent.CLIENT_SHARE_CARD,
    (payload: ChatShareCardPayload) => {
      void (async () => {
        try {
          const channel = isClientChannel(payload?.channel)
            ? payload.channel
            : "global";
          await chatService.shareCard(
            socket,
            channel,
            payload?.userCardInstanceId
          );
        } catch (error) {
          emitError(socket, error, "share_card");
        }
      })();
    }
  );
}

export default registerChatHandlers;
