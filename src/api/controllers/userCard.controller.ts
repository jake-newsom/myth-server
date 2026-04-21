import { Response } from "express";
import CardModel from "../../models/card.model";
import { AuthenticatedRequest } from "../../types";
import { redisCache } from "../../services/redis.cache.service";
import { cacheInvalidation } from "../../services/cache.invalidation.service";

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
