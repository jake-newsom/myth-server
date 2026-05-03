import { Response } from "express";
import CardModel from "../../models/card.model";
import { AuthenticatedRequest } from "../../types";
import { redisCache } from "../../services/redis.cache.service";
import { cacheInvalidation } from "../../services/cache.invalidation.service";
import BorderService from "../../services/border.service";
import logger from "../../utils/logger";

export const getAllUserCards = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { rarity, name, tag, page, limit } = req.query;

    const filters = {
      rarity: rarity as string | undefined,
      name: name as string | undefined,
      tag: tag as string | undefined,
    };

    const pageNumber = parseInt(page as string, 10) || 1;
    const limitNumber = parseInt(limit as string, 10) || 20;

    // Only cache when fetching all cards without filters
    const shouldCache = limitNumber === 0 && !rarity && !name && !tag && pageNumber === 1;
    const cacheKey = `${userId}:cards:all`;

    // Try to get from cache first if caching is applicable
    if (shouldCache) {
      const cachedResult = await redisCache.get(cacheKey);
      if (cachedResult) {
        res.set('X-Cache', 'HIT');
        return res.status(200).json(cachedResult);
      }
    }

    // Fetch from database
    const result = await CardModel.findAllUserCardInstances(
      userId,
      filters,
      pageNumber,
      limitNumber
    );

    // Cache the result if applicable (30 minutes)
    if (shouldCache) {
      await redisCache.set(cacheKey, result, 1800);
      res.set('X-Cache', 'MISS');
    }

    res.status(200).json(result);
  } catch (error) {
    console.error("Error fetching user cards:", error);
    res.status(500).json({ message: "Failed to fetch user cards" });
  }
};

export const setUserCardLockState = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { userCardInstanceId } = req.params;
    const { is_locked } = req.body;

    if (!userCardInstanceId) {
      return res.status(400).json({ message: "userCardInstanceId is required" });
    }

    if (typeof is_locked !== "boolean") {
      return res.status(400).json({
        message: "is_locked is required and must be a boolean",
      });
    }

    const updatedCard = await CardModel.setCardLockState(
      userId,
      userCardInstanceId,
      is_locked
    );

    if (!updatedCard) {
      return res.status(404).json({
        message: "Card not found or does not belong to user",
      });
    }

    await cacheInvalidation.invalidateUserCards(userId);

    return res.status(200).json({
      user_card_instance_id: updatedCard.user_card_instance_id,
      is_locked: updatedCard.is_locked,
    });
  } catch (error) {
    console.error("Error updating user card lock state:", error);
    return res.status(500).json({ message: "Failed to update card lock state" });
  }
};

/**
 * PATCH /api/user-cards/:userCardInstanceId/border
 * Body: { border_id: string | null }
 *
 * Equip a border on a single card instance, or unequip when border_id is null.
 * The service performs ownership and restriction validation in a single
 * UPDATE; this controller just translates the result to an HTTP response.
 */
export const setUserCardBorder = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { userCardInstanceId } = req.params;
    const { border_id } = req.body as { border_id?: string | null };

    if (!userCardInstanceId) {
      return res.status(400).json({ message: "userCardInstanceId is required" });
    }
    if (border_id !== null && typeof border_id !== "string") {
      return res.status(400).json({
        message: "border_id is required and must be a string or null",
      });
    }

    const result = await BorderService.setEquippedBorder(
      userId,
      userCardInstanceId,
      border_id ?? null
    );

    if (!result.success) {
      const status =
        result.error === "Card not found for user" ||
        result.error === "Border not found"
          ? 404
          : 400;
      return res.status(status).json({ message: result.error });
    }

    return res.status(200).json({
      user_card_instance_id: result.user_card_instance_id,
      equipped_border_id: result.equipped_border_id ?? null,
    });
  } catch (error) {
    logger.error(
      "Error setting card border",
      { userId: req.user?.user_id, instanceId: req.params.userCardInstanceId },
      error instanceof Error ? error : new Error(String(error))
    );
    return res.status(500).json({ message: "Failed to set card border" });
  }
};

/**
 * POST /api/user-cards/borders/equip-all
 * Body: { border_id: string }
 *
 * Equip the given border on every card instance owned by the user that:
 *   - currently has no border equipped, AND
 *   - matches the border's restrictions (character_id / set_id), if any.
 */
export const equipBorderOnAllEmpty = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { border_id } = req.body as { border_id?: string };
    if (!border_id || typeof border_id !== "string") {
      return res
        .status(400)
        .json({ message: "border_id is required and must be a string" });
    }

    const result = await BorderService.equipBorderOnAllEmpty(userId, border_id);
    if (!result.success) {
      return res.status(400).json({ message: result.error });
    }

    return res.status(200).json({
      affected_count: result.affected_count,
      border_id,
    });
  } catch (error) {
    logger.error(
      "Error equipping border on all empty cards",
      { userId: req.user?.user_id },
      error instanceof Error ? error : new Error(String(error))
    );
    return res.status(500).json({ message: "Failed to equip border" });
  }
};

/**
 * POST /api/user-cards/borders/unequip-all
 *
 * Clear the equipped border on every card the user owns. Idempotent.
 */
export const unequipAllBorders = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const result = await BorderService.unequipAll(userId);
    return res.status(200).json({ affected_count: result.affected_count });
  } catch (error) {
    logger.error(
      "Error unequipping all borders",
      { userId: req.user?.user_id },
      error instanceof Error ? error : new Error(String(error))
    );
    return res.status(500).json({ message: "Failed to unequip borders" });
  }
};
