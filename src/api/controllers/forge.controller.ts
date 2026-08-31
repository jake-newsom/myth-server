import { Response } from "express";
import ForgeService from "../../services/forge.service";
import { AuthenticatedRequest } from "../../types/middleware.types";
import { FORGE_CONFIG } from "../../config/constants";

/**
 * Forge endpoints: read/save the player's in-progress craft, and redeem it.
 *
 * Every route checks the flag and 403s when off, so the feature can be killed
 * for everyone without a redeploy. The client hides the tab on the same flag;
 * this is the server-side half of that switch.
 */
const ForgeController = {
  /**
   * The player's saved draft plus the config the panel prices against.
   *
   * Costs are shipped to the client so the cost summary can update instantly
   * as the player tweaks the build, without a round-trip per tap. The server
   * still re-prices at craft time — this copy is for display only.
   */
  async getForge(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        return res
          .status(401)
          .json({ status: "error", message: "User not authenticated" });
      }

      if (!(await ForgeService.isEnabled(userId))) {
        return res
          .status(403)
          .json({ status: "error", message: "The Forge is not available." });
      }

      const draft = await ForgeService.getDraftState(userId);

      return res.status(200).json({
        status: "success",
        data: {
          draft,
          config: {
            tiers: FORGE_CONFIG.TIERS,
            upgrades: FORGE_CONFIG.UPGRADES,
            tier_cost: FORGE_CONFIG.TIER_COST,
            character_cost: FORGE_CONFIG.CHARACTER_COST,
            variant_multiplier: FORGE_CONFIG.VARIANT_MULTIPLIER,
            // Reroll prices by lock count, so the button can show the cost of
            // the next roll without a round-trip. Display only, like the rest
            // of this block — `reforge` re-prices server-side.
            reforge_cost_by_locks: FORGE_CONFIG.REFORGE.COST_BY_LOCKS,
            reforge_min_offset: FORGE_CONFIG.REFORGE.MIN_OFFSET,
            reforge_max_offset: FORGE_CONFIG.REFORGE.MAX_OFFSET,
          },
        },
      });
    } catch (error) {
      return res
        .status(500)
        .json({ status: "error", message: "Failed to load the Forge" });
    }
  },

  /** Persist the configuration the player is saving up for. */
  async saveDraft(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        return res
          .status(401)
          .json({ status: "error", message: "User not authenticated" });
      }

      if (!(await ForgeService.isEnabled(userId))) {
        return res
          .status(403)
          .json({ status: "error", message: "The Forge is not available." });
      }

      const draft = await ForgeService.saveDraft(userId, {
        tier: req.body?.tier,
        character_id: req.body?.character_id ?? null,
        upgrade: req.body?.upgrade,
      });

      return res.status(200).json({ status: "success", data: { draft } });
    } catch (error) {
      return res
        .status(500)
        .json({ status: "error", message: "Failed to save your Forge draft" });
    }
  },

  /** Abandon the saved draft. */
  async clearDraft(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        return res
          .status(401)
          .json({ status: "error", message: "User not authenticated" });
      }

      await ForgeService.clearDraft(userId);
      return res.status(200).json({ status: "success" });
    } catch (error) {
      return res
        .status(500)
        .json({ status: "error", message: "Failed to clear your Forge draft" });
    }
  },

  /**
   * Reroll the unlocked edge powers of the saved draft.
   *
   * The client sends only which edges are locked; the offsets themselves are
   * generated server-side, since they decide combat power and the odds must
   * not be reachable from a modified client.
   */
  async reforge(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        return res
          .status(401)
          .json({ status: "error", message: "User not authenticated" });
      }

      if (!(await ForgeService.isEnabled(userId))) {
        return res
          .status(403)
          .json({ status: "error", message: "Reforging is not available." });
      }

      const result = await ForgeService.reforge(userId, req.body?.locks);

      // Same shape as craft: a refused reroll is a 400 with success:false,
      // which the panel surfaces as a toast rather than an error state.
      return res.status(result.success ? 200 : 400).json({
        status: result.success ? "success" : "error",
        message: result.message,
        data: result,
      });
    } catch (error) {
      return res
        .status(500)
        .json({ status: "error", message: "Reforging failed" });
    }
  },

  /** Spend the fragments and mint the card. */
  async craft(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        return res
          .status(401)
          .json({ status: "error", message: "User not authenticated" });
      }

      const result = await ForgeService.craft(userId, {
        tier: req.body?.tier,
        character_id: req.body?.character_id ?? null,
        upgrade: req.body?.upgrade,
        card_variant_id: req.body?.card_variant_id ?? null,
      });

      // A failed craft is a spent-nothing outcome the panel shows as a toast,
      // not an exception: 200 with success:false keeps the client's one
      // response shape.
      return res.status(result.success ? 200 : 400).json({
        status: result.success ? "success" : "error",
        message: result.message,
        data: result,
      });
    } catch (error) {
      return res
        .status(500)
        .json({ status: "error", message: "Forging failed" });
    }
  },
};

export default ForgeController;
