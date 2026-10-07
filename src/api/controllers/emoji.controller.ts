import { Response } from "express";
import { AuthenticatedRequest } from "../../types";
import EmojiService, { EmojiValidationError } from "../../services/emoji.service";
import logger from "../../utils/logger";

const toError = (e: unknown) => (e instanceof Error ? e : new Error(String(e)));

const EmojiController = {
  async getMine(req: AuthenticatedRequest, res: Response) {
    const userId = req.user?.user_id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    try {
      return res.status(200).json(await EmojiService.getMyEmojis(userId));
    } catch (error) {
      logger.error("Error fetching emojis", { userId }, toError(error));
      return res.status(500).json({ message: "Failed to fetch emojis" });
    }
  },

  /** Body: { quick_emojis?: string[], hide_opponent_emojis?: boolean } */
  async updateSettings(req: AuthenticatedRequest, res: Response) {
    const userId = req.user?.user_id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const { quick_emojis, hide_opponent_emojis } = req.body ?? {};
    if (quick_emojis === undefined && hide_opponent_emojis === undefined) {
      return res.status(400).json({ message: "Nothing to update" });
    }
    if (
      hide_opponent_emojis !== undefined &&
      typeof hide_opponent_emojis !== "boolean"
    ) {
      return res
        .status(400)
        .json({ message: "hide_opponent_emojis must be a boolean" });
    }
    try {
      if (quick_emojis !== undefined) {
        await EmojiService.setQuickEmojis(userId, quick_emojis);
      }
      if (hide_opponent_emojis !== undefined) {
        await EmojiService.setHideOpponentEmojis(userId, hide_opponent_emojis);
      }
      return res.status(200).json(await EmojiService.getMyEmojis(userId));
    } catch (error) {
      if (error instanceof EmojiValidationError) {
        return res.status(400).json({ message: error.message });
      }
      logger.error("Error updating emoji settings", { userId }, toError(error));
      return res.status(500).json({ message: "Failed to update emojis" });
    }
  },

  /** Admin. Body: { userId: string, emojiId: string } */
  async adminGrant(req: AuthenticatedRequest, res: Response) {
    const { userId, emojiId } = req.body ?? {};
    if (typeof userId !== "string" || typeof emojiId !== "string") {
      return res.status(400).json({ message: "userId and emojiId are required" });
    }
    try {
      const granted = await EmojiService.grantEmoji(userId, emojiId, "admin");
      return res.status(200).json({ granted });
    } catch (error) {
      logger.error("Error granting emoji", { userId, emojiId }, toError(error));
      return res.status(500).json({ message: "Failed to grant emoji" });
    }
  },
};

export default EmojiController;
