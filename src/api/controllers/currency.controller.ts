import { Request, Response } from "express";
import UserModel from "../../models/user.model";
import db from "../../config/db.config";

// Pack prices (can be configured)
const PACK_PRICES = {
  gems: 5, // 5 gems per pack
};

export const getCurrencies = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      gems: user.gems,
      fate_coins: user.fate_coins,
      card_fragments: user.card_fragments,
      echoes: user.echoes,
      pack_count: user.pack_count,
      total_xp: user.total_xp,
      // Legacy field for backward compatibility
      in_game_currency: user.in_game_currency,
    });
  } catch (error) {
    console.error("Error fetching currencies:", error);
    res.status(500).json({ error: "Failed to fetch currencies" });
  }
};

export const purchasePacks = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const { quantity, currency_type } = req.body;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    // Validation
    if (!quantity || quantity <= 0 || !Number.isInteger(quantity)) {
      return res.status(400).json({
        error: "Invalid quantity - must be a positive integer",
      });
    }

    if (!currency_type || currency_type !== "gems") {
      return res.status(400).json({
        error: "Invalid currency_type - must be 'gems'",
      });
    }

    const pricePerPack = PACK_PRICES.gems;
    const totalCost = quantity * pricePerPack;

    const client = await db.getClient();
    try {
      await client.query("BEGIN");

      // Atomically deduct gems (fails if insufficient) and add packs in one transaction
      const { rows: deductRows } = await client.query(
        `UPDATE users SET gems = gems - $1 WHERE user_id = $2 AND gems >= $1
         RETURNING gems`,
        [totalCost, userId]
      );

      if (deductRows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: `Insufficient gems. Need ${totalCost}.`,
          required: totalCost,
        });
      }

      const { rows: packRows } = await client.query(
        `UPDATE users SET pack_count = pack_count + $1 WHERE user_id = $2
         RETURNING gems, pack_count`,
        [quantity, userId]
      );

      await client.query("COMMIT");

      res.json({
        purchase_details: {
          quantity,
          currency_type,
          cost_per_pack: pricePerPack,
          total_cost: totalCost,
        },
        updated_currencies: {
          gems: packRows[0].gems,
          pack_count: packRows[0].pack_count,
        },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error purchasing packs:", error);
    res.status(500).json({ error: "Failed to purchase packs" });
  }
};

export const getPackPrices = async (req: Request, res: Response) => {
  try {
    res.json(PACK_PRICES);
  } catch (error) {
    console.error("Error fetching pack prices:", error);
    res.status(500).json({ error: "Failed to fetch pack prices" });
  }
};
