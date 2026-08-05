import db from "../config/db.config";
import { CHAT_CONFIG } from "../config/constants";
import {
  ChatChannelType,
  ChatMessageKind,
  ChatMessageRow,
  ChatPayload,
} from "../types/chat.types";

/**
 * SQL-only layer for chat. No validation, no entitlement checks, no
 * broadcasting -- those belong to chat.service.ts. Callers are expected to
 * have already resolved the channel via `resolveChannelForUser`.
 */

export interface InsertChatMessageInput {
  channelType: ChatChannelType;
  channelKey: string | null;
  senderId: string | null;
  senderUsername: string | null;
  kind: ChatMessageKind;
  body: string | null;
  payload: ChatPayload;
}

export interface ChatUserStateRow {
  user_id: string;
  profanity_filter_enabled: boolean;
  muted_until: Date | null;
  muted_reason: string | null;
  updated_at: Date;
}

export interface ChatHistoryFilters {
  channelType?: ChatChannelType;
  channelKey?: string | null;
  senderId?: string;
  since?: Date;
  until?: Date;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
}

const ChatModel = {
  /**
   * Persist a message. The body is stored raw and unmasked -- filtering is a
   * render-time concern (see profanityFilter.service), so moderation review
   * sees what was actually said.
   */
  async insertMessage(input: InsertChatMessageInput): Promise<ChatMessageRow> {
    const query = `
      INSERT INTO "chat_messages" (
        channel_type, channel_key, sender_id, sender_username,
        kind, body, payload
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *;
    `;
    const { rows } = await db.query(query, [
      input.channelType,
      input.channelKey,
      input.senderId,
      input.senderUsername,
      input.kind,
      input.body,
      input.payload ? JSON.stringify(input.payload) : null,
    ]);
    return rows[0] as ChatMessageRow;
  },

  /**
   * Newest-N in a channel, oldest-first in the returned array so callers can
   * append directly to a chronological list. Uses
   * chat_messages_channel_recent_idx.
   */
  async getRecentByChannel(
    channelType: ChatChannelType,
    channelKey: string | null,
    limit: number
  ): Promise<ChatMessageRow[]> {
    const query = `
      SELECT * FROM (
        SELECT *
        FROM "chat_messages"
        WHERE channel_type = $1
          AND channel_key IS NOT DISTINCT FROM $2
          AND is_deleted = false
        ORDER BY created_at DESC
        LIMIT $3
      ) recent
      ORDER BY created_at ASC;
    `;
    const { rows } = await db.query(query, [channelType, channelKey, limit]);
    return rows as ChatMessageRow[];
  },

  async findMessageById(messageId: string): Promise<ChatMessageRow | null> {
    const { rows } = await db.query(
      `SELECT * FROM "chat_messages" WHERE message_id = $1`,
      [messageId]
    );
    return (rows[0] as ChatMessageRow) ?? null;
  },

  /**
   * Soft-delete. Returns the row so the caller knows which room to broadcast
   * the removal to, or null if it was missing or already deleted.
   */
  async softDeleteMessage(
    messageId: string,
    deletedBy: string
  ): Promise<ChatMessageRow | null> {
    const query = `
      UPDATE "chat_messages"
      SET is_deleted = true, deleted_by = $2, deleted_at = NOW()
      WHERE message_id = $1 AND is_deleted = false
      RETURNING *;
    `;
    const { rows } = await db.query(query, [messageId, deletedBy]);
    return (rows[0] as ChatMessageRow) ?? null;
  },

  /**
   * Moderation history search. Admin-only at the route layer.
   */
  async searchMessages(
    filters: ChatHistoryFilters
  ): Promise<{ messages: ChatMessageRow[]; total: number }> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    const add = (clause: string, value: unknown): void => {
      values.push(value);
      conditions.push(clause.replace("$?", `$${values.length}`));
    };

    if (filters.channelType) add("channel_type = $?", filters.channelType);
    if (filters.channelKey !== undefined) {
      add("channel_key IS NOT DISTINCT FROM $?", filters.channelKey);
    }
    if (filters.senderId) add("sender_id = $?", filters.senderId);
    if (filters.since) add("created_at >= $?", filters.since);
    if (filters.until) add("created_at <= $?", filters.until);
    if (!filters.includeDeleted) conditions.push("is_deleted = false");

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = Math.min(filters.limit ?? 100, 500);
    const offset = filters.offset ?? 0;

    const countResult = await db.query(
      `SELECT COUNT(*)::int AS total FROM "chat_messages" ${where}`,
      values
    );

    const { rows } = await db.query(
      `SELECT * FROM "chat_messages" ${where}
       ORDER BY created_at DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset]
    );

    return {
      messages: rows as ChatMessageRow[],
      total: countResult.rows[0]?.total ?? 0,
    };
  },

  // --- chat_user_state -----------------------------------------------------

  async getUserState(userId: string): Promise<ChatUserStateRow | null> {
    const { rows } = await db.query(
      `SELECT * FROM "chat_user_state" WHERE user_id = $1`,
      [userId]
    );
    return (rows[0] as ChatUserStateRow) ?? null;
  },

  /**
   * Upsert the profanity filter preference. Returns the resulting state.
   */
  async setProfanityFilter(
    userId: string,
    enabled: boolean
  ): Promise<ChatUserStateRow> {
    const query = `
      INSERT INTO "chat_user_state" (user_id, profanity_filter_enabled)
      VALUES ($1, $2)
      ON CONFLICT (user_id) DO UPDATE
        SET profanity_filter_enabled = EXCLUDED.profanity_filter_enabled,
            updated_at = NOW()
      RETURNING *;
    `;
    const { rows } = await db.query(query, [userId, enabled]);
    return rows[0] as ChatUserStateRow;
  },

  async setMute(
    userId: string,
    mutedUntil: Date | null,
    reason: string | null
  ): Promise<ChatUserStateRow> {
    const query = `
      INSERT INTO "chat_user_state" (user_id, muted_until, muted_reason)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id) DO UPDATE
        SET muted_until = EXCLUDED.muted_until,
            muted_reason = EXCLUDED.muted_reason,
            updated_at = NOW()
      RETURNING *;
    `;
    const { rows } = await db.query(query, [userId, mutedUntil, reason]);
    return rows[0] as ChatUserStateRow;
  },

  /** User ids with a mute still in effect -- used to exempt them from sweeps. */
  async getActivelyMutedUserIds(): Promise<string[]> {
    const { rows } = await db.query(
      `SELECT user_id FROM "chat_user_state" WHERE muted_until > NOW()`
    );
    return rows.map((r: { user_id: string }) => r.user_id);
  },

  // --- Reports -------------------------------------------------------------

  /**
   * Idempotent per (message, reporter): re-reporting is a no-op rather than a
   * way to inflate a report count.
   */
  async insertReport(
    messageId: string,
    reporterId: string,
    reason: string | null
  ): Promise<void> {
    await db.query(
      `INSERT INTO "chat_reports" (message_id, reporter_id, reason)
       VALUES ($1, $2, $3)
       ON CONFLICT (message_id, reporter_id) DO NOTHING`,
      [messageId, reporterId, reason]
    );
  },

  async listReports(limit = 100, offset = 0): Promise<unknown[]> {
    const { rows } = await db.query(
      `SELECT r.report_id, r.reason, r.created_at,
              r.reporter_id, reporter.username AS reporter_username,
              m.message_id, m.body, m.kind, m.channel_type, m.is_deleted,
              m.sender_id, m.sender_username, m.created_at AS message_created_at
       FROM "chat_reports" r
       JOIN "chat_messages" m ON m.message_id = r.message_id
       LEFT JOIN "users" reporter ON reporter.user_id = r.reporter_id
       ORDER BY r.created_at DESC
       LIMIT $1 OFFSET $2`,
      [Math.min(limit, 500), offset]
    );
    return rows;
  },

  // --- Retention -----------------------------------------------------------

  /**
   * Delete one batch of expired messages. Keeps moderator-deleted rows (audit
   * trail) and anything authored by a currently-muted user (open case).
   * Returns the number of rows removed so the caller can loop until drained.
   */
  async deleteExpiredBatch(
    retentionDays: number,
    batchSize: number
  ): Promise<number> {
    const query = `
      DELETE FROM "chat_messages"
      WHERE message_id IN (
        SELECT m.message_id
        FROM "chat_messages" m
        LEFT JOIN "chat_user_state" s ON s.user_id = m.sender_id
        WHERE m.created_at < NOW() - ($1 || ' days')::interval
          AND m.is_deleted = false
          AND (s.muted_until IS NULL OR s.muted_until <= NOW())
        LIMIT $2
      );
    `;
    const result = await db.query(query, [retentionDays, batchSize]);
    return result.rowCount ?? 0;
  },

  /**
   * Drain expired messages in batches. Returns the total removed.
   */
  async sweepExpired(
    retentionDays: number = CHAT_CONFIG.RETENTION_DAYS,
    batchSize: number = CHAT_CONFIG.RETENTION_SWEEP_BATCH
  ): Promise<number> {
    let total = 0;
    // Bounded so a pathological backlog can't spin here indefinitely; the
    // next scheduled run picks up whatever is left.
    for (let i = 0; i < 100; i++) {
      const removed = await this.deleteExpiredBatch(retentionDays, batchSize);
      total += removed;
      if (removed < batchSize) break;
    }
    return total;
  },
};

export default ChatModel;
