import { Request, Response } from "express";
import PackService from "../../services/pack.service";
import PackModel from "../../models/pack.model";
import UserModel from "../../models/user.model";
import { AuthenticatedRequest } from "../../types";

const PackController = {
  /**
   * Packs the shop should list. Replaces the old "released sets" listing as
   * the source of the shop carousel.
   */
  async getAvailablePacks(_req: Request, res: Response) {
    try {
      const packs = await PackModel.findAvailable();
      return res.status(200).json({
        status: "success",
        data: packs,
      });
    } catch (error) {
      console.error("Error getting available packs:", error);
      return res.status(500).json({
        status: "error",
        message: "Internal server error",
      });
    }
  },

  async getAllPacks(_req: Request, res: Response) {
    try {
      const packs = await PackModel.findAll();
      return res.status(200).json({ status: "success", data: packs });
    } catch (error) {
      console.error("Error getting packs:", error);
      return res.status(500).json({
        status: "error",
        message: "Internal server error",
      });
    }
  },

  async createPack(req: AuthenticatedRequest, res: Response) {
    try {
      const { name, slug, description, image_url, is_released, released_at, sort_order } =
        req.body;

      if (!name || !slug) {
        return res.status(400).json({
          status: "error",
          message: "Pack name and slug are required",
        });
      }

      const existing = await PackModel.findBySlug(slug);
      if (existing) {
        return res.status(409).json({
          status: "error",
          message: `A pack with slug "${slug}" already exists`,
        });
      }

      const pack = await PackModel.create({
        name,
        slug,
        description,
        image_url,
        is_released,
        released_at: released_at ? new Date(released_at) : null,
        sort_order,
      });

      return res.status(201).json({ status: "success", data: pack });
    } catch (error) {
      console.error("Error creating pack:", error);
      return res.status(500).json({
        status: "error",
        message: "Internal server error",
      });
    }
  },

  async updatePack(req: AuthenticatedRequest, res: Response) {
    try {
      const { packId } = req.params;
      const updates = { ...req.body };
      if (updates.released_at !== undefined) {
        updates.released_at = updates.released_at
          ? new Date(updates.released_at)
          : null;
      }

      const pack = await PackModel.update(packId, updates);
      if (!pack) {
        return res
          .status(404)
          .json({ status: "error", message: "Pack not found" });
      }

      return res.status(200).json({ status: "success", data: pack });
    } catch (error) {
      console.error("Error updating pack:", error);
      return res.status(500).json({
        status: "error",
        message: "Internal server error",
      });
    }
  },

  /**
   * Replace a pack's card list wholesale. This is how mixed packs are
   * authored -- membership is explicit, not derived from set.
   */
  async setPackCards(req: AuthenticatedRequest, res: Response) {
    try {
      const { packId } = req.params;
      const { card_variant_ids } = req.body;

      if (!Array.isArray(card_variant_ids)) {
        return res.status(400).json({
          status: "error",
          message: "card_variant_ids must be an array",
        });
      }

      const pack = await PackModel.findById(packId);
      if (!pack) {
        return res
          .status(404)
          .json({ status: "error", message: "Pack not found" });
      }

      const count = await PackModel.setCardVariants(packId, card_variant_ids);
      return res.status(200).json({
        status: "success",
        data: { pack_id: packId, card_count: count },
      });
    } catch (error) {
      console.error("Error setting pack cards:", error);
      return res.status(500).json({
        status: "error",
        message: "Internal server error",
      });
    }
  },

  async deletePack(req: AuthenticatedRequest, res: Response) {
    try {
      const { packId } = req.params;
      const deleted = await PackModel.delete(packId);
      if (!deleted) {
        return res
          .status(404)
          .json({ status: "error", message: "Pack not found" });
      }
      return res.status(204).send();
    } catch (error) {
      console.error("Error deleting pack:", error);
      return res.status(500).json({
        status: "error",
        message: "Internal server error",
      });
    }
  },

  async getPackRates(_req: Request, res: Response) {
    try {
      const config = PackService.getPackRateConfiguration();
      return res.status(200).json({
        status: "success",
        data: config,
      });
    } catch (error) {
      console.error("Error getting pack rates:", error);
      return res.status(500).json({
        status: "error",
        message: "Internal server error",
      });
    }
  },

  async openPack(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.user_id;
      // `setId` is the pre-packs field name. Clients built before packs
      // shipped still send it, and because the packs migration seeds one
      // pack per released set, resolving it by name keeps them working
      // until they update. Remove once the min app version is past that.
      const { packId: rawPackId, setId: legacySetId, count } = req.body;

      if (!userId) {
        return res.status(401).json({
          status: "error",
          message: "User not authenticated",
        });
      }

      let packId = rawPackId;
      if (!packId && legacySetId) {
        packId = await PackService.resolveLegacySetIdToPackId(legacySetId);
      }

      if (!packId) {
        return res.status(400).json({
          status: "error",
          message: "Pack ID is required",
        });
      }

      const packsToOpen = Math.max(1, parseInt(count, 10) || 1);
      const result = await PackService.openMultiplePacks(
        userId,
        packId,
        packsToOpen
      );

      if (!result.success) {
        return res.status(400).json({
          status: "error",
          message: result.message || "Not enough resources to purchase packs",
        });
      }

      return res.status(200).json({
        packs: result.packs,
        remainingPacks: result.remainingPacks,
        remainingGems: result.remainingGems,
        godPacks: result.godPacks || [], // Include God Pack information
      });
    } catch (error) {
      console.error("Error opening packs:", error);
      if (error instanceof Error) {
        return res.status(400).json({
          status: "error",
          message: error.message,
        });
      }
      return res.status(500).json({
        status: "error",
        message: "Internal server error",
      });
    }
  },

  async getUserPacks(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.user_id;

      if (!userId) {
        return res.status(401).json({
          status: "error",
          message: "User not authenticated",
        });
      }

      const packCount = await UserModel.getPackCount(userId);

      return res.status(200).json({
        pack_count: packCount,
      });
    } catch (error) {
      console.error("Error getting user pack count:", error);
      return res.status(500).json({
        status: "error",
        message: "Internal server error",
      });
    }
  },
};

export default PackController;
