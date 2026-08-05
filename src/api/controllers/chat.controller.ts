import { Response } from "express";
import { AuthenticatedRequest } from "../../types/middleware.types";
import chatService from "../../services/chat.service";
import chatCards, { ShowcaseResult } from "../../services/chatCards.service";
import ChatModel from "../../models/chat.model";
import { redisCache } from "../../services/redis.cache.service";
import { CHAT_CONFIG } from "../../config/constants";
import { ChatChannelType, ChatError } from "../../types/chat.types";
import logger from "../../utils/logger";

const showcaseCacheKey = (userId: string): string => `chat:showcase:${userId}`;

class ChatController {
  private getUserId(req: AuthenticatedRequest, res: Response): string | null {
    const userId = req.user?.user_id;
    if (!userId) {
      res.status(401).json({ error: { message: "Authentication required." } });
      return null;
    }
    return userId;
  }

  /**
   * Translate a thrown error into a response. ChatError carries a client-safe
   * message and status; anything else is logged and reported generically.
   */
  private handleError(res: Response, error: unknown, context: string): void {
    if (error instanceof ChatError) {
      res.status(error.statusCode).json({
        error: { message: error.message, code: error.code },
      });
      return;
    }

    logger.error(
      `[chat] ${context} failed`,
      {},
      error instanceof Error ? error : new Error(String(error))
    );
    res.status(500).json({ error: { message: "Internal server error." } });
  }

  // --- Settings ------------------------------------------------------------

  async getSettings(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = this.getUserId(req, res);
      if (!userId) return;

      const enabled = await chatService.getProfanityFilterEnabled(userId);
      res.status(200).json({ profanityFilterEnabled: enabled });
    } catch (error) {
      this.handleError(res, error, "getSettings");
    }
  }

  async updateSettings(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = this.getUserId(req, res);
      if (!userId) return;

      const { profanityFilterEnabled } = req.body ?? {};
      if (typeof profanityFilterEnabled !== "boolean") {
        res.status(400).json({
          error: { message: "profanityFilterEnabled must be a boolean." },
        });
        return;
      }

      const enabled = await chatService.setProfanityFilterEnabled(
        userId,
        profanityFilterEnabled
      );
      res.status(200).json({ profanityFilterEnabled: enabled });
    } catch (error) {
      this.handleError(res, error, "updateSettings");
    }
  }

  // --- Public profile ------------------------------------------------------

  /**
   * A player's chat profile: gamer tag + strongest cards.
   *
   * Public by design — it's the card shown when you tap someone in chat — but
   * deliberately narrow: no instance ids, collection size, currency or email.
   * Cached briefly so tapping through several users in a busy chat isn't N
   * uncached multi-join queries.
   */
  async getShowcase(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const requesterId = this.getUserId(req, res);
      if (!requesterId) return;

      const { userId } = req.params;
      if (!userId) {
        res.status(400).json({ error: { message: "userId is required." } });
        return;
      }

      const cacheKey = showcaseCacheKey(userId);
      const cached = await redisCache.get<ShowcaseResult>(cacheKey);
      if (cached) {
        res.status(200).json(cached);
        return;
      }

      const showcase = await chatCards.getShowcaseForUser(userId);
      await redisCache.set(
        cacheKey,
        showcase,
        CHAT_CONFIG.SHOWCASE_CACHE_TTL_SECONDS
      );

      res.status(200).json(showcase);
    } catch (error) {
      this.handleError(res, error, "getShowcase");
    }
  }

  // --- Reporting (any authenticated user) ----------------------------------

  async reportMessage(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = this.getUserId(req, res);
      if (!userId) return;

      const { messageId, reason } = req.body ?? {};
      if (typeof messageId !== "string" || !messageId) {
        res.status(400).json({ error: { message: "messageId is required." } });
        return;
      }

      const trimmedReason =
        typeof reason === "string" ? reason.trim().slice(0, 500) : null;

      await chatService.reportMessage(messageId, userId, trimmedReason);
      res.status(204).send();
    } catch (error) {
      this.handleError(res, error, "reportMessage");
    }
  }

  // --- Moderation (admin only; gated at the route layer) -------------------

  async getHistory(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const {
        channelType,
        senderId,
        since,
        until,
        includeDeleted,
        limit,
        offset,
      } = req.query;

      const result = await ChatModel.searchMessages({
        channelType: channelType as ChatChannelType | undefined,
        senderId: typeof senderId === "string" ? senderId : undefined,
        since: typeof since === "string" ? new Date(since) : undefined,
        until: typeof until === "string" ? new Date(until) : undefined,
        includeDeleted: includeDeleted === "true",
        limit: limit ? parseInt(String(limit), 10) : undefined,
        offset: offset ? parseInt(String(offset), 10) : undefined,
      });

      res.status(200).json(result);
    } catch (error) {
      this.handleError(res, error, "getHistory");
    }
  }

  async listReports(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { limit, offset } = req.query;
      const reports = await ChatModel.listReports(
        limit ? parseInt(String(limit), 10) : undefined,
        offset ? parseInt(String(offset), 10) : undefined
      );
      res.status(200).json({ reports });
    } catch (error) {
      this.handleError(res, error, "listReports");
    }
  }

  async deleteMessage(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const moderatorId = this.getUserId(req, res);
      if (!moderatorId) return;

      const { messageId } = req.params;
      await chatService.deleteMessage(messageId, moderatorId);
      res.status(204).send();
    } catch (error) {
      this.handleError(res, error, "deleteMessage");
    }
  }

  async muteUser(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const moderatorId = this.getUserId(req, res);
      if (!moderatorId) return;

      const { userId, durationMinutes, reason } = req.body ?? {};
      if (typeof userId !== "string" || !userId) {
        res.status(400).json({ error: { message: "userId is required." } });
        return;
      }
      if (typeof durationMinutes !== "number" || durationMinutes < 0) {
        res.status(400).json({
          error: { message: "durationMinutes must be a non-negative number." },
        });
        return;
      }

      const result = await chatService.muteUser(
        userId,
        durationMinutes,
        typeof reason === "string" ? reason : null
      );

      logger.info("[chat] User muted by moderator", {
        moderatorId,
        userId,
        durationMinutes,
      });

      res.status(200).json(result);
    } catch (error) {
      this.handleError(res, error, "muteUser");
    }
  }
}

export default new ChatController();
