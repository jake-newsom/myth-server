import { Request, Response } from "express";
import UserModel from "../../models/user.model";

// Pack prices (can be configured)
const PACK_PRICES = {
  gold: 50, // 50 gold per pack
  gems: 5, // 5 gems per pack (premium currency)
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
      success: true,
      currencies: {
        gold: user.gold,
        gems: user.gems,
        total_xp: user.total_xp,
        // Legacy field for backward compatibility
        in_game_currency: user.in_game_currency,
      },
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

    if (!currency_type || !["gold", "gems"].includes(currency_type)) {
      return res.status(400).json({
        error: "Invalid currency_type - must be 'gold' or 'gems'",
      });
    }

    const pricePerPack = PACK_PRICES[currency_type as keyof typeof PACK_PRICES];
    const totalCost = quantity * pricePerPack;

    // Get current user
    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Check if user has enough currency
    const currentAmount = currency_type === "gold" ? user.gold : user.gems;
    if (currentAmount < totalCost) {
      return res.status(400).json({
        error: `Insufficient ${currency_type}. You have ${currentAmount}, need ${totalCost}`,
        required: totalCost,
        available: currentAmount,
      });
    }

    // Process purchase
    const updatedUser =
      currency_type === "gold"
        ? await UserModel.spendGold(userId, totalCost)
        : await UserModel.spendGems(userId, totalCost);

    if (!updatedUser) {
      return res.status(500).json({ error: "Failed to deduct currency" });
    }

    // Add packs
    const finalUser = await UserModel.addPacks(userId, quantity);
    if (!finalUser) {
      return res.status(500).json({ error: "Failed to add packs" });
    }

    res.json({
      success: true,
      message: `Successfully purchased ${quantity} pack(s) for ${totalCost} ${currency_type}`,
      purchase_details: {
        quantity,
        currency_type,
        cost_per_pack: pricePerPack,
        total_cost: totalCost,
      },
      updated_currencies: {
        gold: finalUser.gold,
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
    const { gold_amount, gems_amount, reason } = req.body;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    // Validation
    if (
      (!gold_amount && !gems_amount) ||
      (gold_amount !== undefined &&
        (gold_amount < 0 || !Number.isInteger(gold_amount))) ||
      (gems_amount !== undefined &&
        (gems_amount < 0 || !Number.isInteger(gems_amount)))
    ) {
      return res.status(400).json({
        error: "Invalid currency amounts - must be non-negative integers",
      });
    }

    const goldToAdd = gold_amount || 0;
    const gemsToAdd = gems_amount || 0;

    let updatedUser;
    if (goldToAdd > 0 && gemsToAdd > 0) {
      updatedUser = await UserModel.updateBothCurrencies(
        userId,
        goldToAdd,
        gemsToAdd
      );
    } else if (goldToAdd > 0) {
      updatedUser = await UserModel.updateGold(userId, goldToAdd);
    } else if (gemsToAdd > 0) {
      updatedUser = await UserModel.updateGems(userId, gemsToAdd);
    } else {
      return res.status(400).json({ error: "No currency amounts specified" });
    }

    if (!updatedUser) {
      return res.status(500).json({ error: "Failed to award currency" });
    }

    res.json({
      success: true,
      message: `Successfully awarded ${goldToAdd} gold and ${gemsToAdd} gems`,
      reason: reason || "Manual award",
      updated_currencies: {
        gold: updatedUser.gold,
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
    res.json({
      success: true,
      pack_prices: PACK_PRICES,
      message: "Current pack prices in the store",
    });
  } catch (error) {
    console.error("Error fetching pack prices:", error);
    res.status(500).json({ error: "Failed to fetch pack prices" });
  }
};
