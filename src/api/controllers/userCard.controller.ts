import { Response } from "express";
import CardModel from "../../models/card.model";
import { AuthenticatedRequest } from "../../types";
import { redisCache } from "../../services/redis.cache.service";

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
