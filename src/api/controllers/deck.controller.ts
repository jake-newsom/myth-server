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
import { DECK_CONFIG, USER_LIMITS } from "../../config/constants";

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
  if (instanceIds.length !== DECK_CONFIG.DECK_SIZE) {
    throw {
      statusCode: 400,
      message: `Deck must contain exactly ${DECK_CONFIG.DECK_SIZE} cards. Found: ${instanceIds.length}.`,
    };
  }

  // Batch query to fetch all instance details at once (fixes N+1 query issue)
  const instancePlaceholders = instanceIds
    .map((_, index) => `$${index + 2}`)
    .join(",");
  const batchInstanceQuery = `
    SELECT uci.user_card_instance_id, uci.card_id as base_card_id, c.rarity, c.name
    FROM "user_owned_cards" uci 
    JOIN "cards" c ON uci.card_id = c.card_id
    WHERE uci.user_card_instance_id IN (${instancePlaceholders}) AND uci.user_id = $1;
  `;

  const instanceRes = await client.query(batchInstanceQuery, [
    userId,
    ...instanceIds,
  ]);

  // Check if all instances were found
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

  let legendaryCount = 0;
  const baseCardCounts = new Map<string, number>();

  // Process all instances in a single loop
  for (const row of instanceRes.rows) {
    const { base_card_id, rarity } = row;

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

  if (legendaryCount > DECK_CONFIG.MAX_LEGENDARY_CARDS) {
    throw {
      statusCode: 400,
      message: `Deck cannot contain more than ${DECK_CONFIG.MAX_LEGENDARY_CARDS} Legendary cards. Found: ${legendaryCount}.`,
    };
  }

  // Create a map of card IDs to names for better error messages
  const cardIdToName = new Map<string, string>();
  for (const row of instanceRes.rows) {
    cardIdToName.set(row.base_card_id, row.name);
  }

  for (const [cardId, count] of baseCardCounts.entries()) {
    if (count > DECK_CONFIG.MAX_IDENTICAL_BASE_CARDS) {
      const cardName = cardIdToName.get(cardId) || `Card ID: ${cardId}`;
      throw {
        statusCode: 400,
        message: `Deck cannot contain more than ${DECK_CONFIG.MAX_IDENTICAL_BASE_CARDS} copies of the same base card (${cardName}). Found: ${count}.`,
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
