import { Namespace } from "socket.io";
import ChatModel from "../models/chat.model";
import { CHAT_CONFIG } from "../config/constants";
import { containsHardBlocked, maskProfanity } from "./profanityFilter.service";
import chatRateLimit from "./chatRateLimit.service";
import { buildCardSharePayload } from "./chatCards.service";
import logger from "../utils/logger";
import { Rarity, RarityUtils } from "../types/card.types";
import { AuthenticatedSocket } from "../types/socket.types";
import {
  ChatChannelType,
  ChatError,
  ChatMessageDTO,
  ChatMessageKind,
  ChatMessageRow,
  ChatPayload,
  ChatSocketEvent,
  ClientChatChannel,
  PackPullPayload,
  ResolvedChannel,
} from "../types/chat.types";

/**
 * Chat orchestration: validate -> filter -> persist -> broadcast.
 *
 * Transport note: this service holds a reference to the `/presence` namespace
 * that is injected once at startup by `setupPresenceNamespace`, rather than
 * reading `app.get("io")`. The dev (ts-node src/app.ts) and prod (node
 * server.js) entrypoints differ in whether `app.set("io", io)` runs, so
 * injection from the namespace itself is the only place guaranteed to have a
 * live `io` in both.
 */

const GLOBAL_ROOM = "chat:global";
const guildRoom = (guildId: string): string => `chat:guild:${guildId}`;

let presenceNamespace: Namespace | null = null;

/**
 * In-memory mirror of `chat_user_state`, populated on socket connect and
 * updated on the settings write. Keeps the per-viewer filter decision and the
 * mute check off the DB on the send hot path.
 */
interface CachedUserState {
  profanityFilterEnabled: boolean;
  mutedUntil: number | null;
  mutedReason: string | null;
}

const userStateCache = new Map<string, CachedUserState>();

const DEFAULT_USER_STATE: CachedUserState = {
  // Default ON: a user who has never touched the setting gets the filter.
  profanityFilterEnabled: true,
  mutedUntil: null,
  mutedReason: null,
};

export function setPresenceNamespace(ns: Namespace): void {
  presenceNamespace = ns;
}

function requireNamespace(): Namespace {
  if (!presenceNamespace) {
    throw new ChatError("Chat transport unavailable.", 503, "server_error");
  }
  return presenceNamespace;
}

// --- User state -------------------------------------------------------------

/**
 * Load a user's chat state into the cache. Called on socket connect so the
 * send path never has to touch the DB for mute/filter checks.
 */
export async function loadUserState(userId: string): Promise<CachedUserState> {
  const cached = userStateCache.get(userId);
  if (cached) return cached;

  let state: CachedUserState = { ...DEFAULT_USER_STATE };
  try {
    const row = await ChatModel.getUserState(userId);
    if (row) {
      state = {
        profanityFilterEnabled: row.profanity_filter_enabled,
        mutedUntil: row.muted_until ? new Date(row.muted_until).getTime() : null,
        mutedReason: row.muted_reason,
      };
    }
  } catch (error) {
    // Fall back to defaults rather than blocking the connection. Defaulting
    // the filter ON is the safe direction.
    logger.error(
      "[chat] Failed to load user state; using defaults",
      { userId },
      error instanceof Error ? error : new Error(String(error))
    );
  }

  userStateCache.set(userId, state);
  return state;
}

/** Drop a user's cached state when their last socket goes away. */
export function releaseUserState(userId: string): void {
  userStateCache.delete(userId);
}

function getCachedState(userId: string): CachedUserState {
  return userStateCache.get(userId) ?? DEFAULT_USER_STATE;
}

export async function getProfanityFilterEnabled(
  userId: string
): Promise<boolean> {
  const state = await loadUserState(userId);
  return state.profanityFilterEnabled;
}

export async function setProfanityFilterEnabled(
  userId: string,
  enabled: boolean
): Promise<boolean> {
  const row = await ChatModel.setProfanityFilter(userId, enabled);
  const existing = userStateCache.get(userId);
  userStateCache.set(userId, {
    ...(existing ?? DEFAULT_USER_STATE),
    profanityFilterEnabled: row.profanity_filter_enabled,
  });
  return row.profanity_filter_enabled;
}

/**
 * Throws if the user is currently muted, and notifies their sockets so the
 * client can show why rather than silently dropping the message.
 */
function assertNotMuted(userId: string): void {
  const state = getCachedState(userId);
  if (state.mutedUntil === null) return;
  if (state.mutedUntil <= Date.now()) return;

  emitToUser(userId, ChatSocketEvent.SERVER_MUTED, {
    until: new Date(state.mutedUntil).toISOString(),
    reason: state.mutedReason,
  });
  throw new ChatError("You are currently muted.", 403, "muted");
}

export async function muteUser(
  userId: string,
  durationMinutes: number,
  reason: string | null
): Promise<{ until: string | null }> {
  const until =
    durationMinutes > 0
      ? new Date(Date.now() + durationMinutes * 60_000)
      : null;

  await ChatModel.setMute(userId, until, reason);

  const existing = userStateCache.get(userId);
  userStateCache.set(userId, {
    ...(existing ?? DEFAULT_USER_STATE),
    mutedUntil: until ? until.getTime() : null,
    mutedReason: reason,
  });

  if (until) {
    emitToUser(userId, ChatSocketEvent.SERVER_MUTED, {
      until: until.toISOString(),
      reason,
    });
  }

  return { until: until ? until.toISOString() : null };
}

// --- Channel resolution -----------------------------------------------------

/**
 * TODO(guilds): replace the body with
 *   SELECT guild_id FROM guild_members WHERE user_id = $1
 * when the guilds feature lands. Everything downstream (room naming, the
 * `guild` enum value, join/leave handling, the client tab) is already built
 * and inert until this returns a value.
 */
async function getGuildIdForUser(_userId: string): Promise<string | null> {
  return null;
}

/**
 * Map a client's requested channel to a server-verified channel + socket room.
 *
 * This is the ONLY place channel entitlement is decided. Handlers must never
 * trust a client-supplied channel string or key: a forged `channelKey` is
 * discarded here, not honored. Guild privacy rests on this — a non-member's
 * socket is never joined to the guild room, so they never receive the frames.
 * That is real isolation, not client-side filtering.
 */
export async function resolveChannelForUser(
  userId: string,
  requested: { type: ClientChatChannel }
): Promise<ResolvedChannel> {
  if (requested.type === "global") {
    return { type: "global", key: null, room: GLOBAL_ROOM };
  }

  if (requested.type === "guild") {
    const guildId = await getGuildIdForUser(userId);
    if (!guildId) {
      throw new ChatError("You are not in a guild.", 403, "forbidden");
    }
    // Any client-supplied key is ignored entirely — the key is derived from
    // the server's view of membership, so asking for someone else's guild
    // returns your own.
    return { type: "guild", key: guildId, room: guildRoom(guildId) };
  }

  throw new ChatError("Unknown channel.", 400, "invalid");
}

/** The system channel, used by server-authored posts. Not client-requestable. */
export function globalSystemChannel(): ResolvedChannel {
  return { type: "global", key: null, room: GLOBAL_ROOM };
}

/**
 * Join a socket to every channel it is entitled to. Unentitled channels are
 * skipped silently rather than erroring, so a guildless client can request
 * both without special-casing.
 */
export async function subscribeSocket(
  socket: AuthenticatedSocket,
  channels: ClientChatChannel[]
): Promise<ChatChannelType[]> {
  const joined: ChatChannelType[] = [];

  for (const channel of channels) {
    try {
      const resolved = await resolveChannelForUser(socket.user.user_id, {
        type: channel,
      });
      socket.join(resolved.room);
      joined.push(resolved.type);
    } catch {
      // Not entitled — skip silently.
    }
  }

  return joined;
}

/**
 * Move a user's live sockets between guild rooms without a reconnect.
 * Call on guild join/leave once guilds ship.
 */
export async function refreshGuildRoomsForUser(userId: string): Promise<void> {
  const ns = requireNamespace();
  const sockets = await ns.in(userRoomName(userId)).fetchSockets();
  if (sockets.length === 0) return;

  const guildId = await getGuildIdForUser(userId);

  for (const socket of sockets) {
    for (const room of socket.rooms) {
      if (room.startsWith("chat:guild:")) socket.leave(room);
    }
    if (guildId) socket.join(guildRoom(guildId));
  }
}

/** Mirrors `userRoom` in namespace.presence.ts without importing it (cycle). */
function userRoomName(userId: string): string {
  return `user:${userId}`;
}

// --- Broadcasting -----------------------------------------------------------

function toDTO(row: ChatMessageRow, body: string | null): ChatMessageDTO {
  return {
    messageId: row.message_id,
    channelType: row.channel_type,
    kind: row.kind,
    senderId: row.sender_id,
    senderUsername: row.sender_username,
    body,
    payload: row.payload,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
  };
}

function emitToUser(
  userId: string,
  event: ChatSocketEvent,
  payload: unknown
): void {
  if (!presenceNamespace) return;
  presenceNamespace.to(userRoomName(userId)).emit(event, payload);
}

/**
 * Broadcast a message to a room, applying the profanity filter per viewer.
 *
 * The filter is a *viewer* preference, so one frame cannot serve everyone.
 * The identical-string fast path matters: most messages contain no profanity,
 * so `masked === raw` and we emit a single frame to the whole room, keeping
 * the per-socket loop off the hot path entirely. Only a message that actually
 * needs masking pays for the split emit.
 */
async function broadcastMessage(
  channel: ResolvedChannel,
  row: ChatMessageRow
): Promise<void> {
  const ns = requireNamespace();
  const raw = row.body;

  if (raw === null) {
    // Banners and announcements carry no free text — nothing to filter.
    ns.to(channel.room).emit(ChatSocketEvent.SERVER_MESSAGE, toDTO(row, null));
    return;
  }

  const masked = maskProfanity(raw);

  if (masked === raw) {
    ns.to(channel.room).emit(ChatSocketEvent.SERVER_MESSAGE, toDTO(row, raw));
    return;
  }

  // Split emit — only for the rare message that actually needs it.
  const rawDTO = toDTO(row, raw);
  const maskedDTO = toDTO(row, masked);

  const sockets = await ns.in(channel.room).fetchSockets();

  // Make sure every viewer's preference is actually loaded before deciding.
  // A socket can be in the room before its state has been warmed (the
  // connect-time warm is fire-and-forget, and `chat:subscribe` joins rooms
  // without warming at all), and an unwarmed viewer would silently fall back
  // to the default instead of their real setting.
  const viewerIds = new Set<string>();
  for (const socket of sockets) {
    const viewerId = (socket.data as { userId?: string })?.userId;
    if (viewerId && !userStateCache.has(viewerId)) viewerIds.add(viewerId);
  }
  if (viewerIds.size > 0) {
    await Promise.all([...viewerIds].map((id) => loadUserState(id)));
  }

  for (const socket of sockets) {
    const viewerId = (socket.data as { userId?: string })?.userId;
    const wantsFilter = viewerId
      ? getCachedState(viewerId).profanityFilterEnabled
      : true;
    socket.emit(
      ChatSocketEvent.SERVER_MESSAGE,
      wantsFilter ? maskedDTO : rawDTO
    );
  }
}

// --- Send pipeline ----------------------------------------------------------

function normalizeBody(input: unknown): string {
  if (typeof input !== "string") {
    throw new ChatError("Message must be text.", 400, "invalid");
  }

  const collapsed = input
    // Collapse runs of 3+ newlines to two, so a message can't be a wall of
    // whitespace that pushes the channel off screen.
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!collapsed) {
    throw new ChatError("Message is empty.", 400, "invalid");
  }

  if (collapsed.length > CHAT_CONFIG.MAX_MESSAGE_LENGTH) {
    throw new ChatError(
      `Message is too long (max ${CHAT_CONFIG.MAX_MESSAGE_LENGTH} characters).`,
      400,
      "invalid"
    );
  }

  return collapsed;
}

/**
 * Full user-authored text send. Throws ChatError on any rejection so the
 * socket handler can translate it into a single `chat:error` frame.
 */
export async function sendTextMessage(
  socket: AuthenticatedSocket,
  requestedChannel: ClientChatChannel,
  rawBody: unknown
): Promise<void> {
  const userId = socket.user.user_id;

  // Rate limit first — reject before touching the DB.
  const limit = chatRateLimit.consumeMessage(userId);
  if (!limit.allowed) {
    throw new ChatError(
      "You're sending messages too quickly.",
      429,
      "rate_limited"
    );
  }

  assertNotMuted(userId);

  const channel = await resolveChannelForUser(userId, {
    type: requestedChannel,
  });

  const body = normalizeBody(rawBody);

  // Tier 1: rejected for everyone regardless of any toggle. Never persisted,
  // never broadcast.
  if (containsHardBlocked(body)) {
    throw new ChatError(
      "That message can't be sent.",
      400,
      "blocked"
    );
  }

  // Persisted RAW. Masking is render-time, so moderation review sees what was
  // actually said and one viewer's preference isn't baked into history.
  const row = await ChatModel.insertMessage({
    channelType: channel.type,
    channelKey: channel.key,
    senderId: userId,
    senderUsername: socket.user.username,
    kind: "text",
    body,
    payload: null,
  });

  await broadcastMessage(channel, row);
}

/**
 * Share a card the user owns.
 *
 * The client supplies only a card instance id; ownership and every stat in the
 * payload are resolved server-side by chatCards.service, so a client can
 * neither share a card it doesn't own nor inflate the stats of one it does.
 *
 * This is user-authored, so it consumes rate limit — and shares are limited
 * more tightly than text on top of the shared bucket.
 */
export async function shareCard(
  socket: AuthenticatedSocket,
  requestedChannel: ClientChatChannel,
  userCardInstanceId: unknown
): Promise<void> {
  const userId = socket.user.user_id;

  const limit = chatRateLimit.consumeShare(userId);
  if (!limit.allowed) {
    throw new ChatError(
      `You can share another card in ${Math.ceil(limit.retryAfterMs / 1000)}s.`,
      429,
      "rate_limited"
    );
  }

  assertNotMuted(userId);

  const channel = await resolveChannelForUser(userId, {
    type: requestedChannel,
  });

  const payload = await buildCardSharePayload(
    userId,
    typeof userCardInstanceId === "string" ? userCardInstanceId : ""
  );

  const row = await ChatModel.insertMessage({
    channelType: channel.type,
    channelKey: channel.key,
    senderId: userId,
    senderUsername: socket.user.username,
    kind: "card_share",
    body: null,
    payload,
  });

  await broadcastMessage(channel, row);
}

/**
 * Server-authored post (banners, announcements). Bypasses rate limiting and
 * profanity filtering — there is no free text — but must NOT bypass the
 * channel resolver, so these can never be forged into a channel.
 */
export async function postSystemMessage(input: {
  channel: ResolvedChannel;
  kind: Exclude<ChatMessageKind, "text">;
  senderId: string | null;
  senderUsername: string | null;
  payload: ChatPayload;
}): Promise<void> {
  const row = await ChatModel.insertMessage({
    channelType: input.channel.type,
    channelKey: input.channel.key,
    senderId: input.senderId,
    senderUsername: input.senderUsername,
    kind: input.kind,
    body: null,
    payload: input.payload,
  });

  await broadcastMessage(input.channel, row);
}

// --- Banner-generating events -----------------------------------------------

/**
 * Banner predicate for pack pulls: legendary tiers WITH a "+" upgrade only.
 * Plain `legendary` deliberately does not qualify.
 */
export function isBannerWorthyRarity(rarity: Rarity): boolean {
  return (
    RarityUtils.getBaseRarity(rarity) === "legendary" && rarity.includes("+")
  );
}

/** Orders the "+" tiers so a multi-pull picks the best one. */
function upgradeTierRank(rarity: Rarity): number {
  const plusCount = (rarity.match(/\+/g) ?? []).length;
  return plusCount;
}

export type PackPullCandidate = Omit<PackPullPayload, "packName">;

/**
 * Post at most ONE banner for a pack opening, even when a God Pack yields
 * several qualifying cards — otherwise a 10-card God Pack spams the global
 * channel with five banners in a single frame. Picks the highest "+" tier,
 * tie-broken by pull order.
 *
 * Never throws: a chat failure must not fail or roll back a pack opening.
 */
export async function postPackPullBanner(
  userId: string,
  username: string,
  cards: PackPullCandidate[],
  packName: string | null
): Promise<void> {
  try {
    const qualifying = cards.filter((card) =>
      isBannerWorthyRarity(card.rarity)
    );
    if (qualifying.length === 0) return;

    // Highest tier wins; `reduce` keeps the first on a tie, which is pull order.
    const best = qualifying.reduce((winner, candidate) =>
      upgradeTierRank(candidate.rarity) > upgradeTierRank(winner.rarity)
        ? candidate
        : winner
    );

    await postSystemMessage({
      channel: globalSystemChannel(),
      kind: "pack_pull",
      senderId: userId,
      senderUsername: username,
      payload: { ...best, packName },
    });
  } catch (error) {
    logger.error(
      "[chat] Pack pull banner failed",
      { userId },
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

/**
 * Announce a century tower floor clear to the global channel.
 *
 * Must be called AFTER the transaction that advances the floor has committed.
 * Idempotency comes from that transaction's existing row lock and
 * floor-equality guard, so a retried completion cannot double-post; do not
 * add a separate dedupe table.
 *
 * Never throws — the caller's tower rewards are the transaction that matters.
 */
export async function postTowerCenturyAnnouncement(
  userId: string,
  username: string,
  floorNumber: number
): Promise<void> {
  try {
    await postSystemMessage({
      channel: globalSystemChannel(),
      kind: "system_announcement",
      // Server-authored: no sender, so the client renders it as a system line.
      senderId: null,
      senderUsername: null,
      payload: {
        kind: "tower_century",
        floorNumber,
        username,
        userId,
      },
    });
  } catch (error) {
    logger.error(
      "[chat] Tower century announcement failed",
      { userId, floorNumber },
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

// --- Moderation -------------------------------------------------------------

export async function deleteMessage(
  messageId: string,
  moderatorId: string
): Promise<void> {
  const row = await ChatModel.softDeleteMessage(messageId, moderatorId);
  if (!row) {
    throw new ChatError("Message not found.", 404, "not_found");
  }

  const room =
    row.channel_type === "guild" && row.channel_key
      ? guildRoom(row.channel_key)
      : GLOBAL_ROOM;

  presenceNamespace
    ?.to(room)
    .emit(ChatSocketEvent.SERVER_MESSAGE_DELETED, { messageId });
}

export async function reportMessage(
  messageId: string,
  reporterId: string,
  reason: string | null
): Promise<void> {
  const message = await ChatModel.findMessageById(messageId);
  if (!message) {
    throw new ChatError("Message not found.", 404, "not_found");
  }
  await ChatModel.insertReport(messageId, reporterId, reason);
}

export default {
  setPresenceNamespace,
  loadUserState,
  releaseUserState,
  getProfanityFilterEnabled,
  setProfanityFilterEnabled,
  muteUser,
  resolveChannelForUser,
  globalSystemChannel,
  subscribeSocket,
  refreshGuildRoomsForUser,
  sendTextMessage,
  shareCard,
  postSystemMessage,
  isBannerWorthyRarity,
  postPackPullBanner,
  postTowerCenturyAnnouncement,
  deleteMessage,
  reportMessage,
};
