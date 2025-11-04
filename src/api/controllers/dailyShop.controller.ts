import { Request, Response } from "express";
import DailyShopService from "../../services/dailyShop.service";
import DailyShopModel from "../../models/dailyShop.model";
import { AuthenticatedRequest } from "../../types/middleware.types";
import { ShopItemType } from "../../types/database.types";
import db from "../../config/db.config";

const DailyShopController = {
  /**
   * Get daily shop offerings for the authenticated user
   * Shows personalized data including purchase limits and user's purchase history
   */
  async getShop(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        return res.status(401).json({
          status: "error",
          message: "User not authenticated",
        });
      }

      const shopData = await DailyShopService.getUserShopData(userId);

      return res.status(200).json({
        status: "success",
        data: {
          shop_date: DailyShopService.getCurrentShopDate(),
          offerings: shopData.offerings,
          user_purchases: shopData.userPurchases,
          purchase_limits: shopData.purchaseLimits,
          reset_costs: shopData.resetCosts,
          user_currencies: shopData.userCurrencies,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Error fetching daily shop:", error);
      return res.status(500).json({
        status: "error",
        message: "Failed to fetch daily shop",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      });
    }
  },

  /**
   * Purchase an item from the daily shop
   */
  async purchaseItem(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        return res.status(401).json({
          status: "error",
          message: "User not authenticated",
        });
      }

      const { offering_id, quantity, use_reset } = req.body;

      if (!offering_id) {
        return res.status(400).json({
          status: "error",
          message: "offering_id is required",
        });
      }

      // Validate quantity if provided
      if (
        quantity !== undefined &&
        (quantity < 1 || !Number.isInteger(quantity))
      ) {
        return res.status(400).json({
          status: "error",
          message: "quantity must be a positive integer",
        });
      }

      const result = await DailyShopService.purchaseItem(userId, {
        offeringId: offering_id,
        quantity: quantity || 1,
        useReset: use_reset || false,
      });

      if (!result.success) {
        return res.status(400).json({
          status: "error",
          message: result.message,
          timestamp: new Date().toISOString(),
        });
      }

      return res.status(200).json({
        status: "success",
        message: result.message,
        data: {
          purchase: result.purchase,
          new_currency_balance: result.newCurrencyBalance,
          card_received: result.cardReceived,
          packs_received: result.packsReceived,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Error purchasing shop item:", error);
      return res.status(500).json({
        status: "error",
        message: "Failed to process purchase",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      });
    }
  },

  /**
   * Get shop configuration (for admin use)
   */
  async getShopConfig(req: Request, res: Response) {
    try {
      const configs = await DailyShopModel.getShopConfig();

      return res.status(200).json({
        status: "success",
        data: configs,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Error fetching shop config:", error);
      return res.status(500).json({
        status: "error",
        message: "Failed to fetch shop configuration",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      });
    }
  },

  /**
   * Update shop configuration (admin only)
   */
  async updateShopConfig(req: Request, res: Response) {
    try {
      const {
        item_type,
        daily_limit,
        price,
        currency,
        daily_availability,
        is_active,
        reset_price_gems,
      } = req.body;

      if (!item_type) {
        return res.status(400).json({
          status: "error",
          message: "item_type is required",
        });
      }

      // Validate item_type
      const validItemTypes: ShopItemType[] = [
        "legendary_card",
        "epic_card",
        "enhanced_card",
        "pack",
      ];
      if (!validItemTypes.includes(item_type)) {
        return res.status(400).json({
          status: "error",
          message: "Invalid item_type",
        });
      }

      const updates: any = {};
      if (daily_limit !== undefined) updates.daily_limit = daily_limit;
      if (price !== undefined) updates.price = price;
      if (currency !== undefined) updates.currency = currency;
      if (daily_availability !== undefined)
        updates.daily_availability = daily_availability;
      if (is_active !== undefined) updates.is_active = is_active;
      if (reset_price_gems !== undefined)
        updates.reset_price_gems = reset_price_gems;

      const updatedConfig = await DailyShopModel.updateShopConfig(
        item_type,
        updates
      );

      if (!updatedConfig) {
        return res.status(404).json({
          status: "error",
          message: "Shop configuration not found or no changes made",
        });
      }

      return res.status(200).json({
        status: "success",
        message: "Shop configuration updated successfully",
        data: updatedConfig,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Error updating shop config:", error);
      return res.status(500).json({
        status: "error",
        message: "Failed to update shop configuration",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      });
    }
  },

  /**
   * Manually refresh daily shop offerings (admin only)
   */
  async refreshShop(req: Request, res: Response) {
    try {
      const { shop_date } = req.body;

      await DailyShopService.refreshShopOfferings(shop_date);

      return res.status(200).json({
        status: "success",
        message: `Daily shop offerings refreshed for ${
          shop_date || DailyShopService.getCurrentShopDate()
        }`,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Error refreshing shop:", error);
      return res.status(500).json({
        status: "error",
        message: "Failed to refresh shop offerings",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      });
    }
  },

  /**
   * Get shop statistics (admin only)
   */
  async getShopStats(req: Request, res: Response) {
    try {
      const { shop_date } = req.query;

      const stats = await DailyShopService.getShopStats(shop_date as string);

      return res.status(200).json({
        status: "success",
        data: {
          shop_date: shop_date || DailyShopService.getCurrentShopDate(),
          statistics: stats,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Error fetching shop stats:", error);
      return res.status(500).json({
        status: "error",
        message: "Failed to fetch shop statistics",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      });
    }
  },

  /**
   * Get rotation states (admin only)
   */
  async getRotationStates(req: Request, res: Response) {
    try {
      const rotations = await DailyShopModel.getAllRotationStates();

      return res.status(200).json({
        status: "success",
        data: rotations,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Error fetching rotation states:", error);
      return res.status(500).json({
        status: "error",
        message: "Failed to fetch rotation states",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      });
    }
  },

  /**
   * Reset user's daily purchase limits for a specific item type (admin only)
   */
  async resetUserLimits(req: Request, res: Response) {
    try {
      const { user_id, shop_date, item_type } = req.body;

      if (!user_id) {
        return res.status(400).json({
          status: "error",
          message: "user_id is required",
        });
      }

      const targetDate = shop_date || DailyShopService.getCurrentShopDate();

      if (item_type) {
        // Reset specific item type
        const query = `DELETE FROM daily_shop_purchases WHERE user_id = $1 AND shop_date = $2 AND item_type = $3`;
        await db.query(query, [user_id, targetDate, item_type]);
      } else {
        // Reset all purchases for the user on the date
        const query = `DELETE FROM daily_shop_purchases WHERE user_id = $1 AND shop_date = $2`;
        await db.query(query, [user_id, targetDate]);
      }

      return res.status(200).json({
        status: "success",
        message: `Purchase limits reset for user ${user_id} on ${targetDate}${
          item_type ? ` for ${item_type}` : ""
        }`,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Error resetting user limits:", error);
      return res.status(500).json({
        status: "error",
        message: "Failed to reset user limits",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      });
    }
  },
};

export default DailyShopController;
