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
import { RarityUtils } from "../../types/card.types";

/**
 * Validates deck composition based on game rules:
 * - Exactly 20 cards per deck
 * - Maximum 2 copies of the same base card
 * - Maximum 2 legendary cards
 */
async function validateDeckComposition(
  userId: string,
  instanceIds: string[],
  client: PoolClient
): Promise<void> {
  const DECK_SIZE = 20;
  const MAX_IDENTICAL_BASE_CARDS = 2;
  const MAX_LEGENDARY_CARDS = 2;

  if (instanceIds.length !== DECK_SIZE) {
    throw {
      statusCode: 400,
      message: `Deck must contain exactly ${DECK_SIZE} cards. Found: ${instanceIds.length}.`,
    };
  }

  let legendaryCount = 0;
  const baseCardCounts = new Map<string, number>(); // To count instances of the same base card

  for (const instanceId of instanceIds) {
    // Fetch instance details to get its base_card_id and then base card rarity
    // This query is inefficient if done one by one in a loop.
    // A better approach would be to fetch all instance details in one go.
    const instanceQuery = `
      SELECT uci.card_id as base_card_id, c.rarity 
      FROM "user_owned_cards" uci 
      JOIN "cards" c ON uci.card_id = c.card_id
      WHERE uci.user_card_instance_id = $1 AND uci.user_id = $2;
    `;
    const instanceRes = await client.query(instanceQuery, [instanceId, userId]);
    if (instanceRes.rows.length === 0) {
      throw {
        statusCode: 400,
        message: `Card instance ${instanceId} not found or not owned by user.`,
      };
    }
    const { base_card_id, rarity } = instanceRes.rows[0];

    // Count legendary cards (including variants)
    if (RarityUtils.isLegendary(rarity)) {
      legendaryCount++;
    }

    // Count identical base cards
    baseCardCounts.set(
      base_card_id,
      (baseCardCounts.get(base_card_id) || 0) + 1
    );
  }

  if (legendaryCount > MAX_LEGENDARY_CARDS) {
    throw {
      statusCode: 400,
      message: `Deck cannot contain more than ${MAX_LEGENDARY_CARDS} Legendary cards. Found: ${legendaryCount}.`,
    };
  }

  for (const [cardId, count] of baseCardCounts.entries()) {
    if (count > MAX_IDENTICAL_BASE_CARDS) {
      // Need card name for better error message, could fetch it.
      throw {
        statusCode: 400,
        message: `Deck cannot contain more than ${MAX_IDENTICAL_BASE_CARDS} copies of the same base card (Card ID: ${cardId}). Found: ${count}.`,
      };
    }
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
      const { name, user_card_instance_ids } = req.body as CreateDeckRequest;
      const userId = req.user!.user_id;

      if (!name || !user_card_instance_ids) {
        res.status(400).json({
          error: {
            message: "Deck name and user_card_instance_ids are required.",
          },
        });
        return;
      }

      await client.query("BEGIN");
      await validateDeckComposition(userId, user_card_instance_ids, client); // Pass client for DB queries
      const newDeck = await DeckModel.createWithClient(
        client,
        userId,
        name,
        user_card_instance_ids
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
      const { name, user_card_instance_ids } = req.body as UpdateDeckRequest;
      const userId = req.user!.user_id;

      if (name === undefined && user_card_instance_ids === undefined) {
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
      const updatedDeck = await DeckModel.updateWithClient(
        client,
        deckId,
        userId,
        name,
        user_card_instance_ids
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
