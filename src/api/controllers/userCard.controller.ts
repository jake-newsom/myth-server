import { Request, Response } from "express";
import CardModel from "../../models/card.model";
import { AuthenticatedRequest } from "../../types/api.types";

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

    const result = await CardModel.findAllUserCardInstances(
      userId,
      filters,
      pageNumber,
      limitNumber
    );

    res.status(200).json(result);
  } catch (error) {
    console.error("Error fetching user cards:", error);
    res.status(500).json({ message: "Failed to fetch user cards" });
  }
};
