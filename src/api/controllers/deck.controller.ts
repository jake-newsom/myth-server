import DeckModel from "../../models/deck.model";
import CardModel from "../../models/card.model"; // For fetching instance details to check base card rarity
import db from "../../config/db.config";
import { PoolClient } from "pg";
import { Request, Response, NextFunction } from "express";
import {
  CreateDeckRequest,
  UpdateDeckRequest,
  AuthenticatedRequest,
} from "../../types";
import { DECK_CONFIG, USER_LIMITS } from "../../config/constants";
import CardBackService from "../../services/cardBack.service";

/**
 * Validates what a saved deck may hold. Decks may be saved in an unplayable
 * state (fewer than 20 cards, over the power budget, too many copies) so
 * players can work on them incrementally; those rules are enforced at match
 * start instead (see DeckService.assertDeckWithinBudget and the start paths).
 * Saving still requires:
 * - At most DECK_CONFIG.DECK_SIZE cards, no duplicate instances
 * - Every instance owned by the user
 */
async function validateDeckComposition(
  userId: string,
  instanceIds: string[],
  client: PoolClient
): Promise<void> {
  if (!Array.isArray(instanceIds)) {
    throw { statusCode: 400, message: "user_card_instance_ids must be an array." };
  }
  if (instanceIds.length > DECK_CONFIG.DECK_SIZE) {
    throw {
      statusCode: 400,
      message: `Deck cannot contain more than ${DECK_CONFIG.DECK_SIZE} cards. Found: ${instanceIds.length}.`,
    };
  }
  if (new Set(instanceIds).size !== instanceIds.length) {
    throw { statusCode: 400, message: "Deck cannot contain the same card instance twice." };
  }
  if (instanceIds.length === 0) return;

  const instanceRes = await client.query(
    `SELECT user_card_instance_id FROM "user_owned_cards"
     WHERE user_card_instance_id::text = ANY($2::text[]) AND user_id = $1;`,
    [userId, instanceIds]
  );

  if (instanceRes.rows.length !== instanceIds.length) {
    const foundInstanceIds = new Set(
      instanceRes.rows.map((row) => row.user_card_instance_id)
    );
    const missingInstances = instanceIds.filter(
      (id) => !foundInstanceIds.has(id)
    );
    throw {
      statusCode: 400,
      message: `Card instances not found or not owned by user: ${missingInstances.join(
        ", "
      )}.`,
    };
  }
}

const DeckController = {
  /**
   * Create a new deck with specified card instances
   * @route POST /api/decks
   * @param {AuthenticatedRequest} req - Express request object with authenticated user
   * @param {Response} res - Express response object
   * @param {NextFunction} next - Express next middleware function
   */
  async createDeck(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const client: PoolClient = await db.getClient();
    try {
      const { name, user_card_instance_ids, equipped_card_back_id } =
        req.body as CreateDeckRequest;
      const userId = req.user!.user_id;

      if (!name || !user_card_instance_ids) {
        res.status(400).json({
          error: {
            message: "Deck name and user_card_instance_ids are required.",
          },
        });
        return;
      }

      // Check if user has reached the deck limit
      const currentDeckCount = await DeckModel.getUserDeckCount(userId);
      if (currentDeckCount >= USER_LIMITS.MAX_DECKS) {
        res.status(400).json({
          error: {
            message: `You have reached the maximum limit of ${USER_LIMITS.MAX_DECKS} decks.`,
            code: "MAX_DECKS_REACHED",
          },
        });
        return;
      }

      await client.query("BEGIN");
      await validateDeckComposition(userId, user_card_instance_ids, client); // Pass client for DB queries
      const selection = await CardBackService.validateDeckCardBackSelection(
        userId,
        equipped_card_back_id
      );
      if (!selection.valid) {
        throw { statusCode: 400, message: selection.error };
      }
      const newDeck = await DeckModel.createWithClient(
        client,
        userId,
        name,
        user_card_instance_ids,
        equipped_card_back_id
      );
      await client.query("COMMIT");

      res.status(201).json(newDeck);
    } catch (error: any) {
      await client.query("ROLLBACK");
      if (error.statusCode) {
        res
          .status(error.statusCode)
          .json({ error: { message: error.message } });
      } else {
        next(error);
      }
    } finally {
      client.release();
    }
  },

  /**
   * Update an existing deck (name and/or cards)
   * @route PUT /api/decks/:deckId
   * @param {AuthenticatedRequest} req - Express request object with authenticated user
   * @param {Response} res - Express response object
   * @param {NextFunction} next - Express next middleware function
   */
  async updateDeck(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const client: PoolClient = await db.getClient();
    try {
      const { deckId } = req.params;
      const { name, user_card_instance_ids, equipped_card_back_id } =
        req.body as UpdateDeckRequest;
      const userId = req.user!.user_id;

      if (
        name === undefined &&
        user_card_instance_ids === undefined &&
        equipped_card_back_id === undefined
      ) {
        res.status(400).json({
          error: {
            message: "Either name or user_card_instance_ids must be provided.",
          },
        });
        return;
      }

      await client.query("BEGIN");
      if (user_card_instance_ids) {
        // Validate only if instances are being updated
        await validateDeckComposition(userId, user_card_instance_ids, client);
      }
      const selection = await CardBackService.validateDeckCardBackSelection(
        userId,
        equipped_card_back_id
      );
      if (!selection.valid) {
        throw { statusCode: 400, message: selection.error };
      }
      const updatedDeck = await DeckModel.updateWithClient(
        client,
        deckId,
        userId,
        name,
        user_card_instance_ids,
        equipped_card_back_id
      );
      await client.query("COMMIT");

      if (!updatedDeck) {
        // Should be caught by DeckModel if deck not found/owned
        res.status(404).json({
          error: { message: "Deck not found or not owned by user." },
        });
        return;
      }
      res.status(200).json(updatedDeck);
    } catch (error: any) {
      await client.query("ROLLBACK");
      if (error.statusCode) {
        res
          .status(error.statusCode)
          .json({ error: { message: error.message } });
      } else {
        next(error);
      }
    } finally {
      client.release();
    }
  },

  /**
   * Delete a deck
   * @route DELETE /api/decks/:deckId
   * @param {AuthenticatedRequest} req - Express request object with authenticated user
   * @param {Response} res - Express response object
   * @param {NextFunction} next - Express next middleware function
   */
  async deleteDeck(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const client: PoolClient = await db.getClient();
    try {
      const { deckId } = req.params;
      const userId = req.user!.user_id;

      await client.query("BEGIN");
      const success = await DeckModel.delete(deckId, userId);
      await client.query("COMMIT");

      if (!success) {
        res.status(404).json({
          error: { message: "Deck not found or not owned by user." },
        });
        return;
      }
      res.status(204).send();
    } catch (error: any) {
      await client.query("ROLLBACK");
      if (error.statusCode) {
        res
          .status(error.statusCode)
          .json({ error: { message: error.message } });
      } else {
        next(error);
      }
    } finally {
      client.release();
    }
  },
};

export default DeckController;
