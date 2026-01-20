import { Request, Response } from "express";
import UserModel from "../../models/user.model";
import { AuthenticatedRequest } from "../../types";
import db from "../../config/db.config";
import AIAutomationService from "../../services/aiAutomation.service";
import DailyRewardsService from "../../services/dailyRewards.service";
import logger from "../../utils/logger";

/**
 * Admin Controller
 *
 * All endpoints in this controller require admin authentication.
 * See admin.routes.ts for route definitions and middleware application.
 *
 * SECURITY NOTES:
 * - All dangerous database management endpoints (migrations, seeding, etc.) have been REMOVED
 * - Those operations should now be performed via shell access
 * - All actions are logged for audit purposes
 * - Admin middleware enforces role-based access control
 */

const AdminController = {
  // ============================================================================
  // USER MANAGEMENT ENDPOINTS
  // ============================================================================

  /**
   * Give packs to a user
   * POST /api/admin/give-packs
   * Body: { userId: string, quantity: number }
   */
  async givePacksToUser(req: AuthenticatedRequest, res: Response) {
    try {
      const { userId, quantity } = req.body;

      if (!userId || !quantity) {
        return res.status(400).json({
          status: "error",
          message: "userId and quantity are required",
        });
      }

      if (quantity <= 0) {
        return res.status(400).json({
          status: "error",
          message: "Quantity must be greater than 0",
        });
      }

      // Verify user exists
      const user = await UserModel.findById(userId);
      if (!user) {
        return res.status(404).json({
          status: "error",
          message: "User not found",
        });
      }

      // Add packs to user's inventory
      const updatedUser = await UserModel.addPacks(userId, quantity);

      // Log admin action
      logger.info("Admin gave packs to user", {
        adminId: req.user?.user_id,
        adminUsername: req.user?.username,
        targetUserId: userId,
        targetUsername: user.username,
        quantity,
      });

      return res.status(200).json({
        user_id: updatedUser?.user_id,
        username: updatedUser?.username,
        pack_count: updatedUser?.pack_count,
      });
    } catch (error) {
      logger.error(
        "Error giving packs to user",
        { userId: req.body.userId },
        error instanceof Error ? error : new Error(String(error))
      );
      return res.status(500).json({
        status: "error",
        message: "Internal server error",
      });
    }
  },

  /**
   * Set a user's pack quantity
   * POST /api/admin/set-pack-quantity
   * Body: { userId: string, quantity: number }
   */
  async setUserPackQuantity(req: AuthenticatedRequest, res: Response) {
    try {
      const { userId, quantity } = req.body;

      if (!userId || typeof quantity !== "number") {
        return res.status(400).json({
          status: "error",
          message: "userId and quantity are required",
        });
      }

      if (quantity < 0) {
        return res.status(400).json({
          status: "error",
          message: "Quantity cannot be negative",
        });
      }

      // Verify user exists
      const user = await UserModel.findById(userId);
      if (!user) {
        return res.status(404).json({
          status: "error",
          message: "User not found",
        });
      }

      // Set pack quantity for user
      const updatedUser = await UserModel.setPackCount(userId, quantity);

      // Log admin action
      logger.info("Admin set user pack quantity", {
        adminId: req.user?.user_id,
        adminUsername: req.user?.username,
        targetUserId: userId,
        targetUsername: user.username,
        oldQuantity: user.pack_count,
        newQuantity: quantity,
      });

      return res.status(200).json({
        user_id: updatedUser?.user_id,
        username: updatedUser?.username,
        pack_count: updatedUser?.pack_count,
      });
    } catch (error) {
      logger.error(
        "Error setting user pack quantity",
        { userId: req.body.userId },
        error instanceof Error ? error : new Error(String(error))
      );
      return res.status(500).json({
        status: "error",
        message: "Internal server error",
      });
    }
  },

  /**
   * Get a user's pack count
   * GET /api/admin/user-pack-count/:userId
   */
  async getUserPackCount(req: AuthenticatedRequest, res: Response) {
    try {
      const { userId } = req.params;

      if (!userId) {
        return res.status(400).json({
          status: "error",
          message: "User ID is required",
        });
      }

      // Verify user exists
      const user = await UserModel.findById(userId);
      if (!user) {
        return res.status(404).json({
          status: "error",
          message: "User not found",
        });
      }

      const packCount = await UserModel.getPackCount(userId);

      return res.status(200).json({
        user_id: user.user_id,
        username: user.username,
        pack_count: packCount,
      });
    } catch (error) {
      logger.error(
        "Error getting user pack count",
        { userId: req.params.userId },
        error instanceof Error ? error : new Error(String(error))
      );
      return res.status(500).json({
        status: "error",
        message: "Internal server error",
      });
    }
  },

  /**
   * Give fate coins to a user
   * POST /api/admin/give-fate-coins
   * Body: { userId: string, amount: number }
   */
  async giveUserFateCoins(req: AuthenticatedRequest, res: Response) {
    try {
      const { userId, amount } = req.body;

      if (!userId || amount === undefined) {
        return res.status(400).json({
          status: "error",
          message: "userId and amount are required",
          timestamp: new Date().toISOString(),
        });
      }

      // Verify user exists
      const user = await UserModel.findById(userId);
      if (!user) {
        return res.status(404).json({
          status: "error",
          message: "User not found",
          timestamp: new Date().toISOString(),
        });
      }

      const updateQuery = `
        UPDATE users 
        SET fate_coins = fate_coins + $1 
        WHERE user_id = $2 
        RETURNING user_id, username, fate_coins;
      `;

      const { rows } = await db.query(updateQuery, [amount, userId]);

      if (rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "User not found",
          timestamp: new Date().toISOString(),
        });
      }

      // Log admin action
      logger.info("Admin gave fate coins to user", {
        adminId: req.user?.user_id,
        adminUsername: req.user?.username,
        targetUserId: userId,
        targetUsername: user.username,
        amount,
        newBalance: rows[0].fate_coins,
      });

      return res.status(200).json({
        status: "success",
        message: `Successfully gave ${amount} fate coins to user`,
        user: rows[0],
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error(
        "Admin give fate coins endpoint error",
        { userId: req.body.userId },
        error instanceof Error ? error : new Error(String(error))
      );
      return res.status(500).json({
        status: "error",
        message: "Internal server error during fate coin update",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      });
    }
  },

  // ============================================================================
  // AUTOMATION TRIGGER ENDPOINTS
  // ============================================================================

  /**
   * Manually trigger AI fate pick generation (normally runs on schedule)
   * POST /api/admin/trigger-ai-fate-pick
   *
   * This endpoint allows admins to manually trigger the automated fate pick
   * generation that normally runs on a schedule. Useful for testing or
   * manual intervention.
   */
  async triggerAIFatePick(req: AuthenticatedRequest, res: Response) {
    try {
      logger.info("Admin triggering AI fate pick generation", {
        adminId: req.user?.user_id,
        adminUsername: req.user?.username,
      });

      const result = await AIAutomationService.generateAutomatedFatePick();

      if (result.success) {
        logger.info("AI fate pick generated successfully", {
          adminId: req.user?.user_id,
          fatePickId: result.fatePickId,
          setUsed: result.setUsed,
          cardsGenerated: result.cardsGenerated,
        });

        return res.status(200).json({
          status: "success",
          message: result.message,
          data: {
            fatePickId: result.fatePickId,
            setUsed: result.setUsed,
            cardsGenerated: result.cardsGenerated,
          },
          timestamp: new Date().toISOString(),
        });
      } else {
        logger.warn("AI fate pick generation failed", {
          adminId: req.user?.user_id,
          reason: result.message,
        });

        return res.status(400).json({
          status: "error",
          message: result.message,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      logger.error(
        "Admin trigger AI fate pick endpoint error",
        { adminId: req.user?.user_id },
        error instanceof Error ? error : new Error(String(error))
      );
      return res.status(500).json({
        status: "error",
        message: "Internal server error during AI fate pick generation",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      });
    }
  },

  /**
   * Manually trigger daily rewards distribution (normally runs on schedule)
   * POST /api/admin/trigger-daily-rewards
   *
   * This endpoint allows admins to manually trigger the daily rewards
   * distribution (fate coins and packs) that normally runs automatically
   * at 12:00 AM and 12:00 PM UTC. Useful for testing or manual intervention.
   */
  async triggerDailyRewards(req: AuthenticatedRequest, res: Response) {
    try {
      logger.info("Admin triggering daily rewards distribution", {
        adminId: req.user?.user_id,
        adminUsername: req.user?.username,
      });

      const result = await DailyRewardsService.runDailyRewards();

      if (result.success) {
        logger.info("Daily rewards distributed successfully", {
          adminId: req.user?.user_id,
          usersProcessed: result.usersProcessed,
          fateCoinsDistributed: result.fateCoinsDistributed,
          packsDistributed: result.packsDistributed,
        });

        return res.status(200).json({
          status: "success",
          message: result.message,
          data: {
            usersProcessed: result.usersProcessed,
            fateCoinsDistributed: result.fateCoinsDistributed,
            packsDistributed: result.packsDistributed,
          },
          timestamp: new Date().toISOString(),
        });
      } else {
        logger.error("Daily rewards distribution failed", {
          adminId: req.user?.user_id,
          error: result.error,
        });

        return res.status(500).json({
          status: "error",
          message: result.message,
          error: result.error,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      logger.error(
        "Admin trigger daily rewards endpoint error",
        { adminId: req.user?.user_id },
        error instanceof Error ? error : new Error(String(error))
      );
      return res.status(500).json({
        status: "error",
        message: "Internal server error during daily rewards distribution",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      });
    }
  },
};

export default AdminController;
