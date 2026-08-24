import { Request, Response } from "express";
import UserModel from "../../models/user.model";
import SessionService from "../../services/session.service";
import { AuthenticatedRequest } from "../../types";
import db from "../../config/db.config";
import AIAutomationService from "../../services/aiAutomation.service";
import DailyRewardsService from "../../services/dailyRewards.service";
import BorderService from "../../services/border.service";
import CardBackService from "../../services/cardBack.service";
import AchievementService from "../../services/achievement.service";
import { cacheInvalidation } from "../../services/cache.invalidation.service";
import logger from "../../utils/logger";
import { normalizeMinAppVersion } from "../../utils/catalogVersion";

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

/**
 * Normalize and validate a border max_equipped value from request input.
 * Accepts: null / "" / undefined (→ null = unlimited) or a positive integer.
 */
function normalizeMaxEquipped(
  value: unknown
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value === null || value === undefined || value === "") {
    return { ok: true, value: null };
  }
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1) {
    return {
      ok: false,
      error: "max_equipped must be a positive integer or blank for unlimited",
    };
  }
  return { ok: true, value: n };
}

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
          packUsed: result.packUsed,
          cardsGenerated: result.cardsGenerated,
        });

        return res.status(200).json({
          status: "success",
          message: result.message,
          data: {
            fatePickId: result.fatePickId,
            packUsed: result.packUsed,
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

  // ============================================================================
  // ACHIEVEMENT MANAGEMENT ENDPOINTS
  // ============================================================================

  /**
   * POST /api/admin/achievements
   */
  async createAchievement(req: AuthenticatedRequest, res: Response) {
    try {
      const body = req.body || {};
      const required = [
        "achievement_key",
        "title",
        "description",
        "category",
        "type",
        "target_value",
        "rarity",
      ] as const;

      for (const key of required) {
        if (body[key] === undefined || body[key] === null || body[key] === "") {
          return res.status(400).json({
            status: "error",
            message: `${key} is required`,
          });
        }
      }

      const result = await AchievementService.createAdminAchievement(body);
      if (!result.success) {
        return res.status(400).json({
          status: "error",
          message: result.error || "Failed to create achievement",
        });
      }

      logger.info("Admin created achievement", {
        adminId: req.user?.user_id,
        achievementId: result.achievement?.id,
        achievementKey: result.achievement?.achievement_key,
      });

      return res.status(201).json({ data: result.achievement });
    } catch (error) {
      logger.error(
        "Admin create achievement error",
        { adminId: req.user?.user_id },
        error instanceof Error ? error : new Error(String(error))
      );
      return res
        .status(500)
        .json({ status: "error", message: "Failed to create achievement" });
    }
  },

  /**
   * PATCH /api/admin/achievements/:achievementId
   */
  async updateAchievement(req: AuthenticatedRequest, res: Response) {
    try {
      const { achievementId } = req.params;
      if (!achievementId) {
        return res.status(400).json({
          status: "error",
          message: "achievementId is required",
        });
      }

      const updates = req.body || {};
      const result = await AchievementService.updateAdminAchievement(
        achievementId,
        updates
      );

      if (!result.success) {
        const status = result.error === "Achievement not found" ? 404 : 400;
        return res.status(status).json({
          status: "error",
          message: result.error || "Failed to update achievement",
        });
      }

      logger.info("Admin updated achievement", {
        adminId: req.user?.user_id,
        achievementId,
      });

      return res.status(200).json({ data: result.achievement });
    } catch (error) {
      logger.error(
        "Admin update achievement error",
        { achievementId: req.params.achievementId },
        error instanceof Error ? error : new Error(String(error))
      );
      return res
        .status(500)
        .json({ status: "error", message: "Failed to update achievement" });
    }
  },

  /**
   * DELETE /api/admin/achievements/:achievementId
   * Soft-delete by setting is_active=false.
   */
  async deactivateAchievement(req: AuthenticatedRequest, res: Response) {
    try {
      const { achievementId } = req.params;
      if (!achievementId) {
        return res.status(400).json({
          status: "error",
          message: "achievementId is required",
        });
      }

      const result = await AchievementService.deactivateAdminAchievement(
        achievementId
      );
      if (!result.success) {
        const status = result.error === "Achievement not found" ? 404 : 400;
        return res.status(status).json({
          status: "error",
          message: result.error || "Failed to deactivate achievement",
        });
      }

      logger.info("Admin deactivated achievement", {
        adminId: req.user?.user_id,
        achievementId,
      });

      return res.status(200).json({ data: result.achievement });
    } catch (error) {
      logger.error(
        "Admin deactivate achievement error",
        { achievementId: req.params.achievementId },
        error instanceof Error ? error : new Error(String(error))
      );
      return res
        .status(500)
        .json({ status: "error", message: "Failed to deactivate achievement" });
    }
  },

  // ============================================================================
  // BORDER MANAGEMENT ENDPOINTS
  // ============================================================================

  /**
   * GET /api/admin/borders
   * List the full border catalog (including inactive entries).
   */
  async listBorders(_req: AuthenticatedRequest, res: Response) {
    try {
      const borders = await BorderService.getFullCatalog();
      return res.status(200).json({ data: borders });
    } catch (error) {
      logger.error(
        "Admin list borders error",
        {},
        error instanceof Error ? error : new Error(String(error))
      );
      return res
        .status(500)
        .json({ status: "error", message: "Failed to list borders" });
    }
  },

  /**
   * POST /api/admin/borders
   * Body: { name, image_url, description?, animation_key?, character_id?, set_id? }
   */
  async createBorder(req: AuthenticatedRequest, res: Response) {
    try {
      const {
        name,
        description,
        image_url,
        animation_key,
        character_id,
        set_id,
        min_app_version,
        max_equipped,
      } = req.body || {};

      if (!name || typeof name !== "string") {
        return res
          .status(400)
          .json({ status: "error", message: "name is required" });
      }
      if (!image_url || typeof image_url !== "string") {
        return res
          .status(400)
          .json({ status: "error", message: "image_url is required" });
      }

      const minVersion = normalizeMinAppVersion(min_app_version);
      if (!minVersion.ok) {
        return res
          .status(400)
          .json({ status: "error", message: minVersion.error });
      }

      const maxEq = normalizeMaxEquipped(max_equipped);
      if (!maxEq.ok) {
        return res
          .status(400)
          .json({ status: "error", message: maxEq.error });
      }

      const border = await BorderService.createBorder({
        name,
        image_url,
        description: description ?? null,
        animation_key: animation_key ?? null,
        character_id: character_id ?? null,
        set_id: set_id ?? null,
        min_app_version: minVersion.value,
        max_equipped: maxEq.value,
      });

      logger.info("Admin created border", {
        adminId: req.user?.user_id,
        borderId: border.border_id,
        name: border.name,
      });

      return res.status(201).json({ data: border });
    } catch (error) {
      logger.error(
        "Admin create border error",
        { adminId: req.user?.user_id },
        error instanceof Error ? error : new Error(String(error))
      );
      return res
        .status(500)
        .json({ status: "error", message: "Failed to create border" });
    }
  },

  /**
   * PATCH /api/admin/borders/:borderId
   * Body: any subset of { name, description, image_url, animation_key,
   *                       character_id, set_id, is_active }
   */
  async updateBorder(req: AuthenticatedRequest, res: Response) {
    try {
      const { borderId } = req.params;
      if (!borderId) {
        return res
          .status(400)
          .json({ status: "error", message: "borderId is required" });
      }

      const updates = { ...(req.body || {}) };
      if ("min_app_version" in updates) {
        const minVersion = normalizeMinAppVersion(updates.min_app_version);
        if (!minVersion.ok) {
          return res
            .status(400)
            .json({ status: "error", message: minVersion.error });
        }
        updates.min_app_version = minVersion.value;
      }
      if ("max_equipped" in updates) {
        const maxEq = normalizeMaxEquipped(updates.max_equipped);
        if (!maxEq.ok) {
          return res
            .status(400)
            .json({ status: "error", message: maxEq.error });
        }
        updates.max_equipped = maxEq.value;
      }
      const border = await BorderService.updateBorder(borderId, updates);
      if (!border) {
        return res
          .status(404)
          .json({ status: "error", message: "Border not found" });
      }

      logger.info("Admin updated border", {
        adminId: req.user?.user_id,
        borderId,
      });

      return res.status(200).json({ data: border });
    } catch (error) {
      logger.error(
        "Admin update border error",
        { borderId: req.params.borderId },
        error instanceof Error ? error : new Error(String(error))
      );
      return res
        .status(500)
        .json({ status: "error", message: "Failed to update border" });
    }
  },

  /**
   * DELETE /api/admin/borders/:borderId
   * Soft-delete by deactivating the border. Existing equipped/owned references
   * remain intact (the border simply disappears from catalog listings).
   */
  async deactivateBorder(req: AuthenticatedRequest, res: Response) {
    try {
      const { borderId } = req.params;
      if (!borderId) {
        return res
          .status(400)
          .json({ status: "error", message: "borderId is required" });
      }
      const border = await BorderService.deactivateBorder(borderId);
      if (!border) {
        return res
          .status(404)
          .json({ status: "error", message: "Border not found" });
      }

      logger.info("Admin deactivated border", {
        adminId: req.user?.user_id,
        borderId,
      });

      return res.status(200).json({ data: border });
    } catch (error) {
      logger.error(
        "Admin deactivate border error",
        { borderId: req.params.borderId },
        error instanceof Error ? error : new Error(String(error))
      );
      return res
        .status(500)
        .json({ status: "error", message: "Failed to deactivate border" });
    }
  },

  /**
   * POST /api/admin/borders/grant
   * Body: { userId: string, borderId: string }
   *
   * Grant a border to a specific user. Idempotent.
   */
  async grantBorderToUser(req: AuthenticatedRequest, res: Response) {
    try {
      const { userId, borderId } = req.body || {};
      if (!userId || !borderId) {
        return res.status(400).json({
          status: "error",
          message: "userId and borderId are required",
        });
      }

      const user = await UserModel.findById(userId);
      if (!user) {
        return res
          .status(404)
          .json({ status: "error", message: "User not found" });
      }

      const newlyGranted = await BorderService.grantBorder(userId, borderId);

      logger.info("Admin granted border to user", {
        adminId: req.user?.user_id,
        targetUserId: userId,
        borderId,
        newlyGranted,
      });

      return res.status(200).json({
        status: "success",
        newly_granted: newlyGranted,
      });
    } catch (error) {
      logger.error(
        "Admin grant border error",
        { userId: req.body?.userId, borderId: req.body?.borderId },
        error instanceof Error ? error : new Error(String(error))
      );
      return res
        .status(500)
        .json({ status: "error", message: "Failed to grant border" });
    }
  },

  /**
   * POST /api/admin/borders/revoke
   * Body: { userId: string, borderId: string }
   *
   * Remove a border from a user's inventory. Also unequips any cards using it.
   */
  async revokeBorderFromUser(req: AuthenticatedRequest, res: Response) {
    try {
      const { userId, borderId } = req.body || {};
      if (!userId || !borderId) {
        return res.status(400).json({
          status: "error",
          message: "userId and borderId are required",
        });
      }

      const removed = await BorderService.revokeBorder(userId, borderId);

      logger.info("Admin revoked border from user", {
        adminId: req.user?.user_id,
        targetUserId: userId,
        borderId,
        removed,
      });

      return res.status(200).json({
        status: "success",
        removed,
      });
    } catch (error) {
      logger.error(
        "Admin revoke border error",
        { userId: req.body?.userId, borderId: req.body?.borderId },
        error instanceof Error ? error : new Error(String(error))
      );
      return res
        .status(500)
        .json({ status: "error", message: "Failed to revoke border" });
    }
  },

  // ============================================================================
  // CARD BACK MANAGEMENT ENDPOINTS
  // ============================================================================
  async listCardBacks(_req: AuthenticatedRequest, res: Response) {
    try {
      const cardBacks = await CardBackService.getFullCatalog();
      return res.status(200).json({ data: cardBacks });
    } catch (error) {
      logger.error(
        "Admin list card backs error",
        {},
        error instanceof Error ? error : new Error(String(error))
      );
      return res
        .status(500)
        .json({ status: "error", message: "Failed to list card backs" });
    }
  },

  async createCardBack(req: AuthenticatedRequest, res: Response) {
    try {
      const { code_key, name, description, image_url, animation_key, min_app_version } =
        req.body || {};
      if (!code_key || typeof code_key !== "string") {
        return res
          .status(400)
          .json({ status: "error", message: "code_key is required" });
      }
      if (!name || typeof name !== "string") {
        return res
          .status(400)
          .json({ status: "error", message: "name is required" });
      }
      if (!image_url || typeof image_url !== "string") {
        return res
          .status(400)
          .json({ status: "error", message: "image_url is required" });
      }

      const minVersion = normalizeMinAppVersion(min_app_version);
      if (!minVersion.ok) {
        return res
          .status(400)
          .json({ status: "error", message: minVersion.error });
      }

      const cardBack = await CardBackService.createCardBack({
        code_key,
        name,
        description: description ?? null,
        image_url,
        animation_key: animation_key ?? null,
        min_app_version: minVersion.value,
      });

      return res.status(201).json({ data: cardBack });
    } catch (error) {
      logger.error(
        "Admin create card back error",
        { adminId: req.user?.user_id },
        error instanceof Error ? error : new Error(String(error))
      );
      return res
        .status(500)
        .json({ status: "error", message: "Failed to create card back" });
    }
  },

  async updateCardBack(req: AuthenticatedRequest, res: Response) {
    try {
      const { backId } = req.params;
      if (!backId) {
        return res
          .status(400)
          .json({ status: "error", message: "backId is required" });
      }
      const updates = { ...(req.body || {}) };
      if ("min_app_version" in updates) {
        const minVersion = normalizeMinAppVersion(updates.min_app_version);
        if (!minVersion.ok) {
          return res
            .status(400)
            .json({ status: "error", message: minVersion.error });
        }
        updates.min_app_version = minVersion.value;
      }
      const cardBack = await CardBackService.updateCardBack(backId, updates);
      if (!cardBack) {
        return res
          .status(404)
          .json({ status: "error", message: "Card back not found" });
      }
      return res.status(200).json({ data: cardBack });
    } catch (error) {
      logger.error(
        "Admin update card back error",
        { backId: req.params.backId },
        error instanceof Error ? error : new Error(String(error))
      );
      return res
        .status(500)
        .json({ status: "error", message: "Failed to update card back" });
    }
  },

  async deactivateCardBack(req: AuthenticatedRequest, res: Response) {
    try {
      const { backId } = req.params;
      if (!backId) {
        return res
          .status(400)
          .json({ status: "error", message: "backId is required" });
      }
      const cardBack = await CardBackService.deactivateCardBack(backId);
      if (!cardBack) {
        return res
          .status(404)
          .json({ status: "error", message: "Card back not found" });
      }
      return res.status(200).json({ data: cardBack });
    } catch (error) {
      logger.error(
        "Admin deactivate card back error",
        { backId: req.params.backId },
        error instanceof Error ? error : new Error(String(error))
      );
      return res
        .status(500)
        .json({ status: "error", message: "Failed to deactivate card back" });
    }
  },

  async grantCardBackToUser(req: AuthenticatedRequest, res: Response) {
    try {
      const { userId, backId } = req.body || {};
      if (!userId || !backId) {
        return res.status(400).json({
          status: "error",
          message: "userId and backId are required",
        });
      }
      const user = await UserModel.findById(userId);
      if (!user) {
        return res
          .status(404)
          .json({ status: "error", message: "User not found" });
      }
      const newlyGranted = await CardBackService.grantCardBack(userId, backId);
      return res.status(200).json({
        status: "success",
        newly_granted: newlyGranted,
      });
    } catch (error) {
      logger.error(
        "Admin grant card back error",
        { userId: req.body?.userId, backId: req.body?.backId },
        error instanceof Error ? error : new Error(String(error))
      );
      return res
        .status(500)
        .json({ status: "error", message: "Failed to grant card back" });
    }
  },

  async revokeCardBackFromUser(req: AuthenticatedRequest, res: Response) {
    try {
      const { userId, backId } = req.body || {};
      if (!userId || !backId) {
        return res.status(400).json({
          status: "error",
          message: "userId and backId are required",
        });
      }
      const removed = await CardBackService.revokeCardBack(userId, backId);
      return res.status(200).json({
        status: "success",
        removed,
      });
    } catch (error) {
      logger.error(
        "Admin revoke card back error",
        { userId: req.body?.userId, backId: req.body?.backId },
        error instanceof Error ? error : new Error(String(error))
      );
      return res
        .status(500)
        .json({ status: "error", message: "Failed to revoke card back" });
    }
  },

  // ============================================================================
  // CACHE MANAGEMENT ENDPOINTS
  // ============================================================================

  /**
   * Clear the global card catalog cache.
   * POST /api/admin/cache/cards/clear
   *
   * The `cards:all` catalog is cached for 24h. Call this after releasing new
   * cards so the new catalog is served immediately instead of waiting for the
   * TTL to lapse.
   */
  clearCardsCache: async (req: AuthenticatedRequest, res: Response) => {
    try {
      await cacheInvalidation.invalidateGlobalCards();
      logger.info("Admin cleared global cards cache", {
        adminId: req.user?.user_id,
      });
      return res.status(200).json({
        status: "success",
        message: "Global cards cache cleared",
      });
    } catch (error) {
      logger.error(
        "Admin clear cards cache error",
        { adminId: req.user?.user_id },
        error instanceof Error ? error : new Error(String(error))
      );
      return res
        .status(500)
        .json({ status: "error", message: "Failed to clear cards cache" });
    }
  },

  /**
   * Ban a user account.
   *
   * Bans are reversible and non-destructive: the account, its cards, decks and
   * match history all remain. This exists because the only prior option was the
   * hard delete in user.controller.ts, which also destroys games belonging to
   * the banned user's OPPONENTS.
   */
  async banUser(req: AuthenticatedRequest, res: Response) {
    try {
      const { userId, reason } = req.body;

      if (!userId) {
        return res
          .status(400)
          .json({ status: "error", message: "userId is required" });
      }

      const target = await UserModel.findById(userId);
      if (!target) {
        return res
          .status(404)
          .json({ status: "error", message: "User not found" });
      }

      // Refuse to ban admins. Locking yourself (or a colleague) out of the
      // admin console is not something a single click should be able to do.
      if (target.role === "admin") {
        return res.status(403).json({
          status: "error",
          message: "Admin accounts cannot be banned.",
        });
      }

      const banned = await UserModel.banUser(
        userId,
        typeof reason === "string" && reason.trim() ? reason.trim() : null,
        req.user?.user_id ?? null
      );

      // Kick them out now rather than waiting for their access token to expire
      // (up to 15 minutes). The middleware check is the backstop.
      await SessionService.invalidateAllUserSessions(userId);

      logger.info("Admin banned user", {
        adminId: req.user?.user_id,
        adminUsername: req.user?.username,
        targetUserId: userId,
        targetUsername: target.username,
        reason: reason ?? null,
      });

      return res.status(200).json({ status: "success", user: banned });
    } catch (error) {
      logger.error(
        "Admin ban user error",
        { adminId: req.user?.user_id },
        error instanceof Error ? error : new Error(String(error))
      );
      return res
        .status(500)
        .json({ status: "error", message: "Failed to ban user" });
    }
  },

  /** Lift a ban. The user can log in again immediately. */
  async unbanUser(req: AuthenticatedRequest, res: Response) {
    try {
      const { userId } = req.body;

      if (!userId) {
        return res
          .status(400)
          .json({ status: "error", message: "userId is required" });
      }

      const target = await UserModel.findById(userId);
      if (!target) {
        return res
          .status(404)
          .json({ status: "error", message: "User not found" });
      }

      const user = await UserModel.unbanUser(userId);

      logger.info("Admin unbanned user", {
        adminId: req.user?.user_id,
        adminUsername: req.user?.username,
        targetUserId: userId,
        targetUsername: target.username,
      });

      return res.status(200).json({ status: "success", user });
    } catch (error) {
      logger.error(
        "Admin unban user error",
        { adminId: req.user?.user_id },
        error instanceof Error ? error : new Error(String(error))
      );
      return res
        .status(500)
        .json({ status: "error", message: "Failed to unban user" });
    }
  },

  /** List currently banned accounts, newest ban first. */
  async listBannedUsers(req: AuthenticatedRequest, res: Response) {
    try {
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const offset = Math.max(Number(req.query.offset) || 0, 0);
      const users = await UserModel.listBanned(limit, offset);
      return res.status(200).json({ status: "success", users });
    } catch (error) {
      logger.error(
        "Admin list banned users error",
        { adminId: req.user?.user_id },
        error instanceof Error ? error : new Error(String(error))
      );
      return res
        .status(500)
        .json({ status: "error", message: "Failed to list banned users" });
    }
  },

  /** Username search, so the console can find a user to ban without an id. */
  async searchUsers(req: AuthenticatedRequest, res: Response) {
    try {
      const term = String(req.query.q ?? "").trim();
      if (term.length < 2) {
        return res.status(400).json({
          status: "error",
          message: "Search term must be at least 2 characters",
        });
      }
      const users = await UserModel.searchByUsername(term);
      return res.status(200).json({ status: "success", users });
    } catch (error) {
      logger.error(
        "Admin search users error",
        { adminId: req.user?.user_id },
        error instanceof Error ? error : new Error(String(error))
      );
      return res
        .status(500)
        .json({ status: "error", message: "Failed to search users" });
    }
  },
};

export default AdminController;
