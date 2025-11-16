import { Request, Response } from "express";
import UserModel from "../../models/user.model";

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

    // Get current user
    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Check if user has enough gems
    if (user.gems < totalCost) {
      return res.status(400).json({
        error: `Insufficient gems. You have ${user.gems}, need ${totalCost}`,
        required: totalCost,
        available: user.gems,
      });
    }

    // Process purchase
    const updatedUser = await UserModel.spendGems(userId, totalCost);

    if (!updatedUser) {
      return res.status(500).json({ error: "Failed to deduct currency" });
    }

    // Add packs
    const finalUser = await UserModel.addPacks(userId, quantity);
    if (!finalUser) {
      return res.status(500).json({ error: "Failed to add packs" });
    }

    res.json({
      purchase_details: {
        quantity,
        currency_type,
        cost_per_pack: pricePerPack,
        total_cost: totalCost,
      },
      updated_currencies: {
        gems: finalUser.gems,
        pack_count: finalUser.pack_count,
      },
    });
  } catch (error) {
    console.error("Error purchasing packs:", error);
    res.status(500).json({ error: "Failed to purchase packs" });
  }
};

export const awardCurrency = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const { gems_amount, reason } = req.body;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    // Validation
    if (
      !gems_amount ||
      gems_amount < 0 ||
      !Number.isInteger(gems_amount)
    ) {
      return res.status(400).json({
        error: "Invalid gems amount - must be a non-negative integer",
      });
    }

    const updatedUser = await UserModel.updateGems(userId, gems_amount);

    if (!updatedUser) {
      return res.status(500).json({ error: "Failed to award currency" });
    }

    res.json({
      reason: reason || "Manual award",
      updated_currencies: {
        gems: updatedUser.gems,
        total_xp: updatedUser.total_xp,
      },
    });
  } catch (error) {
    console.error("Error awarding currency:", error);
    res.status(500).json({ error: "Failed to award currency" });
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
