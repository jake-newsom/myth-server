import { Request, Response } from "express";
import XpPoolModel from "../../models/xpPool.model";
import XpService from "../../services/xp.service";

export const getXpPools = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const pools = await XpPoolModel.getAllXpPools(userId);
    res.json(pools);
  } catch (error) {
    console.error("Error fetching XP pools:", error);
    res.status(500).json({ error: "Failed to fetch XP pools" });
  }
};

export const getXpPool = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const { cardName } = req.params;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const pool = await XpPoolModel.getXpPool(userId, cardName);
    if (!pool) {
      return res.status(404).json({ error: "XP pool not found" });
    }

    res.json(pool);
  } catch (error) {
    console.error("Error fetching XP pool:", error);
    res.status(500).json({ error: "Failed to fetch XP pool" });
  }
};

export const transferXp = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const { source_card_id, target_card_id } = req.body;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    // Basic validation
    if (!source_card_id || !target_card_id) {
      return res.status(400).json({
        error: "Missing required fields: source_card_id, target_card_id",
      });
    }

    // Prevent transferring to the same card
    if (source_card_id === target_card_id) {
      return res.status(400).json({
        error: "Cannot transfer XP to the same card",
      });
    }

    // Call XP service
    const result = await XpService.transferXp(
      userId,
      source_card_id,
      target_card_id
    );

    if (result.success) {
      // Remove success and message properties, return flattened result
      const { success, message, ...flattenedResult } = result;
      res.json(flattenedResult);
    } else {
      res.status(400).json({ error: result.message });
    }
  } catch (error) {
    console.error("Error transferring XP:", error);
    res.status(500).json({ error: "Failed to transfer XP" });
  }
};

export const sacrificeCards = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const { card_ids } = req.body;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    if (!card_ids || !Array.isArray(card_ids) || card_ids.length === 0) {
      return res.status(400).json({
        error: "Missing or invalid card_ids array",
      });
    }

    // Call XP service
    const result = await XpService.sacrificeCards(userId, card_ids);

    if (result.success) {
      // Remove success and message properties, return flattened result
      const { success, message, ...flattenedResult } = result;
      res.json(flattenedResult);
    } else {
      res.status(400).json({ error: result.message });
    }
  } catch (error) {
    console.error("Error sacrificing cards:", error);
    res.status(500).json({ error: "Failed to sacrifice cards" });
  }
};

export const applyXp = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const { target_card_id, xp_amount } = req.body;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    if (
      !target_card_id ||
      !xp_amount ||
      !Number.isInteger(xp_amount) ||
      xp_amount <= 0
    ) {
      return res.status(400).json({
        error:
          "Missing or invalid target_card_id or xp_amount (must be positive integer)",
      });
    }

    // Call XP service
    const result = await XpService.applyXpFromPool(
      userId,
      target_card_id,
      xp_amount
    );

    if (result.success) {
      // Remove success and message properties, return flattened result
      const { success, message, ...flattenedResult } = result;
      res.json(flattenedResult);
    } else {
      res.status(400).json({ error: result.message });
    }
  } catch (error) {
    console.error("Error applying XP:", error);
    res.status(500).json({ error: "Failed to apply XP" });
  }
};

export const getXpTransferHistory = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const { cardName } = req.query;
    const limit = parseInt(req.query.limit as string) || 50;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const history = await XpPoolModel.getXpTransferHistory(
      userId,
      cardName as string,
      limit
    );

    res.json({
      success: true,
      transfer_history: history,
    });
  } catch (error) {
    console.error("Error fetching XP transfer history:", error);
    res.status(500).json({ error: "Failed to fetch XP transfer history" });
  }
};
