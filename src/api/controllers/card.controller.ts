// src/api/controllers/card.controller.ts
import CardModel from "../../models/card.model";
import { Request, Response, NextFunction } from "express";

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

      console.log("Controller received:", { page, limit, pageNum, limitNum });

      if (isNaN(pageNum) || pageNum < 1) {
        res.status(400).json({
          error: {
            message: "Invalid page value. Must be a positive integer.",
          },
        });
        return;
      }

      if (isNaN(limitNum) || limitNum < 1) {
        res.status(400).json({
          error: {
            message: "Invalid limit value. Must be a positive integer.",
          },
        });
        return;
      }

      // Optional validation of rarity if provided
      if (
        rarity &&
        !["common", "uncommon", "rare", "epic", "legendary"].includes(rarity)
      ) {
        res.status(400).json({
          error: {
            message:
              "Invalid rarity value. Must be one of: common, uncommon, rare, epic, legendary",
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
