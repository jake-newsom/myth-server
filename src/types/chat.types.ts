import { Rarity, PowerValues } from "./card.types";

/**
 * Chat channel + message type definitions shared by the model, service,
 * socket handlers and REST controllers.
 *
 * The channel abstraction is intentionally present at the data and transport
 * layers even though the UI currently exposes only `global`. Adding a channel
 * later is additive: a new enum value, a new room, and a tab.
 */

export type ChatChannelType = "global" | "guild" | "system";

/** Channels a client is allowed to name in a request. */
export type ClientChatChannel = Extract<ChatChannelType, "global" | "guild">;

export type ChatMessageKind =
  | "text"
  | "card_share"
  | "pack_pull"
  | "system_announcement";

/**
 * A channel that has been verified against the requesting user's
 * entitlements. Only `resolveChannelForUser` may construct one.
 */
export interface ResolvedChannel {
  type: ChatChannelType;
  key: string | null;
  room: string;
}

// --- Payload shapes by kind -------------------------------------------------
// Payloads are deliberately snapshots: a shared card must render as it was at
// share time and must survive the card being levelled, traded or consumed
// later. The client never re-fetches a card to render a banner.

/**
 * Everything the client's GameCard needs to render a card faithfully: the set
 * (drives the banner icon + colour), tags (bottom-left badge), the special
 * ability text, exclusivity, and any equipped border.
 *
 * These are part of the snapshot rather than looked up client-side on purpose
 * — a shared card must still render exactly as it was even after the owner
 * re-equips a border, or the card is traded or consumed.
 */
export interface ChatCardPresentation {
  setId: string | null;
  tags: string[];
  isExclusive: boolean;
  specialAbility: {
    abilityId: string;
    name: string;
    description: string;
  } | null;
  equippedBorder: {
    borderId: string;
    name: string;
    imageUrl: string;
    animationKey: string | null;
  } | null;
}

export interface CardSharePayload extends ChatCardPresentation {
  userCardInstanceId: string;
  cardVariantId: string;
  characterName: string;
  rarity: Rarity;
  imageUrl: string | null;
  level: number;
  power: PowerValues;
}

export interface PackPullPayload extends ChatCardPresentation {
  cardVariantId: string;
  characterName: string;
  /** Always a legendary+ tier -- plain `legendary` does not qualify. */
  rarity: Rarity;
  imageUrl: string | null;
  packName: string | null;
  /** Base power, so the banner card shows real numbers rather than zeroes. */
  power: PowerValues;
}

export interface TowerCenturyPayload {
  kind: "tower_century";
  floorNumber: number;
  username: string;
  userId: string;
}

export type SystemAnnouncementPayload = TowerCenturyPayload;

export type ChatPayload =
  | CardSharePayload
  | PackPullPayload
  | SystemAnnouncementPayload
  | null;

// --- Persistence shape ------------------------------------------------------

export interface ChatMessageRow {
  message_id: string;
  channel_type: ChatChannelType;
  channel_key: string | null;
  sender_id: string | null;
  sender_username: string | null;
  kind: ChatMessageKind;
  body: string | null;
  payload: ChatPayload;
  is_deleted: boolean;
  deleted_by: string | null;
  deleted_at: Date | null;
  created_at: Date;
}

/** The wire shape broadcast to clients. */
export interface ChatMessageDTO {
  messageId: string;
  channelType: ChatChannelType;
  kind: ChatMessageKind;
  senderId: string | null;
  senderUsername: string | null;
  body: string | null;
  payload: ChatPayload;
  createdAt: string;
}

// --- Socket events ----------------------------------------------------------

/**
 * Chat events registered on the existing `/presence` namespace. Named
 * distinctly from the legacy (unused) `SocketEvent.SEND_CHAT` /
 * `CHAT_MESSAGE` members on the `/game` namespace to avoid collision.
 */
export enum ChatSocketEvent {
  // Client -> server
  CLIENT_SUBSCRIBE = "chat:subscribe",
  CLIENT_SEND = "chat:send",
  CLIENT_SHARE_CARD = "chat:share_card",

  // Server -> client
  SERVER_MESSAGE = "chat:message",
  SERVER_ERROR = "chat:error",
  SERVER_MUTED = "chat:muted",
  SERVER_MESSAGE_DELETED = "chat:message_deleted",
}

export type ChatErrorCode =
  | "rate_limited"
  | "blocked"
  | "muted"
  | "invalid"
  | "forbidden"
  | "not_found"
  | "server_error";

export interface ChatErrorPayload {
  code: ChatErrorCode;
  message: string;
}

export interface ChatMutedPayload {
  until: string;
  reason: string | null;
}

export interface ChatSubscribePayload {
  channels?: ClientChatChannel[];
}

export interface ChatSendPayload {
  channel?: ClientChatChannel;
  body?: string;
}

export interface ChatShareCardPayload {
  channel?: ClientChatChannel;
  userCardInstanceId?: string;
}

// --- Errors -----------------------------------------------------------------

/**
 * Error carrying a client-safe message, a socket error code and an HTTP
 * status, so the same throw can serve both the socket handlers and REST.
 */
export class ChatError extends Error {
  public readonly statusCode: number;
  public readonly code: ChatErrorCode;

  constructor(message: string, statusCode = 400, code: ChatErrorCode = "invalid") {
    super(message);
    this.name = "ChatError";
    this.statusCode = statusCode;
    this.code = code;
  }
}
