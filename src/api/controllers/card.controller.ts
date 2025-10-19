// src/api/controllers/card.controller.ts
import CardModel from "../../models/card.model";
import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { RarityUtils } from "../../types/card.types";

const CardController = {
  /**
   * Get all static cards with optional filtering
   * @route GET /api/cards
   * @param {Request} req - Express request object
   * @param {Response} res - Express response object
   * @param {NextFunction} next - Express next middleware function
   */
  async getAllStaticCards(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const {
        page = "1",
        limit = "20",
        rarity,
        name,
        tag,
        ids,
      } = req.query as {
        page?: string;
        limit?: string;
        rarity?: string;
        name?: string;
        tag?: string;
        ids?: string;
      };

      // Validate page and limit values
      const pageNum = parseInt(page, 10);
      const limitNum = parseInt(limit, 10);

      if (isNaN(pageNum) || pageNum < 1) {
        res.status(400).json({
          error: {
            message: "Invalid page value. Must be a positive integer.",
          },
        });
        return;
      }

      // Allow limit=0 to return all cards (no pagination)
      if (isNaN(limitNum) || limitNum < 0) {
        res.status(400).json({
          error: {
            message:
              "Invalid limit value. Must be a non-negative integer. Use 0 for no limit.",
          },
        });
        return;
      }

      // Optional validation of rarity if provided
      const validRarities = RarityUtils.getAllValidRarities();
      if (rarity && !validRarities.includes(rarity as any)) {
        res.status(400).json({
          error: {
            message:
              "Invalid rarity value. Must be one of: " +
              validRarities.join(", "),
          },
        });
        return;
      }

      // If ids are provided, decode the URL-encoded string first
      let processedIds;
      if (ids) {
        try {
          // Decode URL-encoded string
          const decodedIds = decodeURIComponent(ids);
          // Validate that we have a proper comma-separated list of UUIDs
          if (decodedIds && decodedIds.length > 0) {
            processedIds = decodedIds;
          }
        } catch (e) {
          res.status(400).json({
            error: {
              message:
                "Invalid format for ids parameter. Expected comma-separated list of UUIDs.",
            },
          });
          return;
        }
      }

      const filters = { rarity, name, tag, ids: processedIds };
      const result = await CardModel.findAllStatic(filters, pageNum, limitNum);

      // Add caching headers when returning all cards (limit=0)
      if (limitNum === 0) {
        // Generate ETag based on data content for better cache invalidation
        const dataHash = crypto
          .createHash("md5")
          .update(JSON.stringify(result.data))
          .digest("hex")
          .substring(0, 8);

        // Cache for 1 hour (3600 seconds) for all cards
        res.set({
          "Cache-Control": "public, max-age=3600, s-maxage=3600",
          ETag: `"cards-all-${dataHash}"`, // ETag based on actual data content
          "Last-Modified": new Date().toUTCString(),
          Vary: "Accept-Encoding", // Important for compressed responses
        });
      }

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },

  /**
   * Get a specific static card by ID
   * @route GET /api/cards/:cardId
   * @param {Request} req - Express request object
   * @param {Response} res - Express response object
   * @param {NextFunction} next - Express next middleware function
   */
  async getStaticCardById(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { cardId } = req.params;

      if (!cardId) {
        res.status(400).json({
          error: { message: "Card ID is required." },
        });
        return;
      }

      const card = await CardModel.findStaticByIdWithAbility(cardId);

      if (!card) {
        res.status(404).json({
          error: { message: "Card not found." },
        });
        return;
      }

      res.status(200).json(card);
    } catch (error) {
      next(error);
    }
  },
};

export default CardController;
