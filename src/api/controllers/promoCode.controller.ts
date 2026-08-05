// myth-server/src/api/controllers/promoCode.controller.ts

import { Response } from "express";
import { AuthenticatedRequest } from "../../types";
import PromoCodeService from "../../services/promoCode.service";
import logger from "../../utils/logger";
import { PromoRedemptionFailureReason } from "../../types/promo.types";

/**
 * Rejection reasons that mean "the request was well-formed but the code can't
 * be claimed" map to 409/404/410 rather than a blanket 400, so clients can
 * branch on status as well as on `reason`.
 */
const STATUS_BY_REASON: Record<PromoRedemptionFailureReason, number> = {
  not_found: 404,
  inactive: 410,
  not_started: 409,
  expired: 410,
  claim_limit_reached: 409,
  already_redeemed: 409,
  no_rewards_available: 500,
};

const PromoCodeController = {
  // ---- Player endpoints ----------------------------------------------------

  async redeem(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const { code } = req.body ?? {};
      if (typeof code !== "string" || !code.trim()) {
        return res.status(400).json({ message: "A promo code is required." });
      }

      const result = await PromoCodeService.redeem(userId, code);

      if (!result.success) {
        return res.status(STATUS_BY_REASON[result.reason]).json({
          message: result.message,
          reason: result.reason,
        });
      }

      return res.status(200).json({ data: result });
    } catch (error) {
      logger.error(
        "Error redeeming promo code",
        { userId: req.user?.user_id },
        error instanceof Error ? error : new Error(String(error))
      );
      return res.status(500).json({ message: "Failed to redeem promo code" });
    }
  },

  async preview(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const code = req.params.code;
      if (!code || !code.trim()) {
        return res.status(400).json({ message: "A promo code is required." });
      }

      const result = await PromoCodeService.preview(userId, code);
      if (!result.eligible && result.reason === "not_found") {
        return res
          .status(404)
          .json({ message: result.message, reason: result.reason });
      }

      return res.status(200).json({ data: result });
    } catch (error) {
      logger.error(
        "Error previewing promo code",
        { userId: req.user?.user_id },
        error instanceof Error ? error : new Error(String(error))
      );
      return res.status(500).json({ message: "Failed to look up promo code" });
    }
  },

  // ---- Admin endpoints -----------------------------------------------------

  async listPromoCodes(req: AuthenticatedRequest, res: Response) {
    try {
      const codes = await PromoCodeService.list({
        includeInactive: req.query.includeInactive !== "false",
        limit: Math.min(Number(req.query.limit) || 100, 500),
        offset: Number(req.query.offset) || 0,
      });
      return res.status(200).json({ data: codes });
    } catch (error) {
      logger.error(
        "Error listing promo codes",
        {},
        error instanceof Error ? error : new Error(String(error))
      );
      return res.status(500).json({ message: "Failed to list promo codes" });
    }
  },

  async getPromoCode(req: AuthenticatedRequest, res: Response) {
    try {
      const promo = await PromoCodeService.getById(req.params.promoCodeId);
      if (!promo) {
        return res.status(404).json({ message: "Promo code not found" });
      }
      return res.status(200).json({ data: promo });
    } catch (error) {
      logger.error(
        "Error fetching promo code",
        { promoCodeId: req.params.promoCodeId },
        error instanceof Error ? error : new Error(String(error))
      );
      return res.status(500).json({ message: "Failed to fetch promo code" });
    }
  },

  async createPromoCode(req: AuthenticatedRequest, res: Response) {
    try {
      const { code, description, rewards, max_claims, is_active, starts_at, expires_at } =
        req.body ?? {};

      if (typeof code !== "string" || !code.trim()) {
        return res.status(400).json({ message: "`code` is required." });
      }
      if (
        max_claims !== undefined &&
        max_claims !== null &&
        (!Number.isInteger(max_claims) || max_claims <= 0)
      ) {
        return res
          .status(400)
          .json({ message: "`max_claims` must be a positive integer or null." });
      }

      const rewardErrors = PromoCodeService.validateRewards(rewards);
      if (rewardErrors.length > 0) {
        return res
          .status(400)
          .json({ message: "Invalid rewards.", errors: rewardErrors });
      }

      const promo = await PromoCodeService.create({
        code,
        description,
        rewards,
        max_claims,
        is_active,
        starts_at,
        expires_at,
      });
      return res.status(201).json({ data: promo });
    } catch (error) {
      // Unique violation on `code`.
      if ((error as any)?.code === "23505") {
        return res
          .status(409)
          .json({ message: "A promo code with that code already exists." });
      }
      logger.error(
        "Error creating promo code",
        {},
        error instanceof Error ? error : new Error(String(error))
      );
      return res.status(500).json({ message: "Failed to create promo code" });
    }
  },

  async updatePromoCode(req: AuthenticatedRequest, res: Response) {
    try {
      const body = req.body ?? {};

      if (body.rewards !== undefined) {
        const rewardErrors = PromoCodeService.validateRewards(body.rewards);
        if (rewardErrors.length > 0) {
          return res
            .status(400)
            .json({ message: "Invalid rewards.", errors: rewardErrors });
        }
      }
      if (
        body.max_claims !== undefined &&
        body.max_claims !== null &&
        (!Number.isInteger(body.max_claims) || body.max_claims <= 0)
      ) {
        return res
          .status(400)
          .json({ message: "`max_claims` must be a positive integer or null." });
      }

      const promo = await PromoCodeService.update(req.params.promoCodeId, body);
      if (!promo) {
        return res.status(404).json({ message: "Promo code not found" });
      }
      return res.status(200).json({ data: promo });
    } catch (error) {
      if ((error as any)?.code === "23505") {
        return res
          .status(409)
          .json({ message: "A promo code with that code already exists." });
      }
      // Lowering max_claims below the number already claimed trips the CHECK.
      if ((error as any)?.code === "23514") {
        return res.status(409).json({
          message:
            "`max_claims` cannot be lower than the number of claims already made.",
        });
      }
      logger.error(
        "Error updating promo code",
        { promoCodeId: req.params.promoCodeId },
        error instanceof Error ? error : new Error(String(error))
      );
      return res.status(500).json({ message: "Failed to update promo code" });
    }
  },

  async deletePromoCode(req: AuthenticatedRequest, res: Response) {
    try {
      const deleted = await PromoCodeService.delete(req.params.promoCodeId);
      if (!deleted) {
        return res.status(404).json({ message: "Promo code not found" });
      }
      return res.status(204).send();
    } catch (error) {
      logger.error(
        "Error deleting promo code",
        { promoCodeId: req.params.promoCodeId },
        error instanceof Error ? error : new Error(String(error))
      );
      return res.status(500).json({ message: "Failed to delete promo code" });
    }
  },

  async listRedemptions(req: AuthenticatedRequest, res: Response) {
    try {
      const redemptions = await PromoCodeService.listRedemptions(
        req.params.promoCodeId,
        {
          limit: Math.min(Number(req.query.limit) || 100, 500),
          offset: Number(req.query.offset) || 0,
        }
      );
      return res.status(200).json({ data: redemptions });
    } catch (error) {
      logger.error(
        "Error listing promo code redemptions",
        { promoCodeId: req.params.promoCodeId },
        error instanceof Error ? error : new Error(String(error))
      );
      return res.status(500).json({ message: "Failed to list redemptions" });
    }
  },
};

export default PromoCodeController;
