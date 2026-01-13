import db from "../config/db.config";
// Ensure AI_PLAYER_ID is accessible. If game.controller.ts exports it, use that.
// For now, assuming it will be imported from controller or a constants file.
// Let's adjust the import based on where AI_PLAYER_ID is defined.
// If it's exported from game.controller.ts:
import { AI_PLAYER_ID } from "../api/controllers/game.controller";

// Define a simple type for deck data, expand as needed
interface Deck {
  deck_id: string;
  user_id: string;
  // other deck properties
}

export class DeckNotFoundError extends Error {
  constructor(message: string = "Deck not found") {
    super(message);
    this.name = "DeckNotFoundError";
  }
}

export class DeckAccessError extends Error {
  constructor(
    message: string = "Deck does not belong to the user or is invalid"
  ) {
    super(message);
    this.name = "DeckAccessError";
  }
}

export class EmptyDeckError extends Error {
  constructor(message: string = "Deck is empty") {
    super(message);
    this.name = "EmptyDeckError";
  }
}

class DeckService {
  /**
   * Validates that a deck exists and belongs to the specified user.
   * Throws DeckNotFoundError or DeckAccessError if validation fails.
   */
  async validateUserDeck(deckId: string, userId: string): Promise<Deck> {
    const query = `
      SELECT * FROM "decks"
      WHERE deck_id = $1 AND user_id = $2;
    `;
    const { rows } = await db.query(query, [deckId, userId]);
    if (rows.length === 0) {
      // Check if deck exists at all to give a more specific error
      const checkExistenceQuery = `SELECT deck_id FROM "decks" WHERE deck_id = $1;`;
      const { rows: existenceRows } = await db.query(checkExistenceQuery, [
        deckId,
      ]);
      if (existenceRows.length === 0) {
        throw new DeckNotFoundError(`Deck with ID ${deckId} not found.`);
      }
      throw new DeckAccessError(
        `Deck ${deckId} not found or does not belong to user ${userId}.`
      );
    }
    return rows[0] as Deck;
  }

  /**
   * Retrieves card instance IDs for a given deck.
   */
  async getDeckCardInstances(deckId: string): Promise<string[]> {
    const query = `
      SELECT user_card_instance_id FROM "deck_cards"
      WHERE deck_id = $1;
    `;
    const { rows } = await db.query(query, [deckId]);
    // Note: The plan mentions not throwing EmptyDeckError here by default
    // to match original controller logic. Caller should check length.
    return rows.map((row) => row.user_card_instance_id);
  }

  /**
   * Fetches a random AI deck ID.
   * Returns null if no AI decks are available.
   */
  async getRandomAIDeckId(): Promise<string | null> {
    const query = `
      SELECT deck_id FROM "decks"
      WHERE user_id = $1;
    `;
    const { rows } = await db.query(query, [AI_PLAYER_ID]);
    if (rows.length === 0) {
      return null;
    }
    const randomIndex = Math.floor(Math.random() * rows.length);
    return rows[randomIndex].deck_id;
  }

  /**
   * Validates that a specified AI deck exists and belongs to the AI player.
   * Throws DeckNotFoundError if validation fails.
   */
  async validateAIDeck(deckId: string): Promise<Deck> {
    const query = `
      SELECT * FROM "decks"
      WHERE deck_id = $1 AND user_id = $2;
    `;
    const { rows } = await db.query(query, [deckId, AI_PLAYER_ID]);
    if (rows.length === 0) {
      throw new DeckNotFoundError(`Specified AI deck ${deckId} not found.`);
    }
    return rows[0] as Deck;
  }

  /**
   * Creates AI card copies based on player's card instances.
   * (This is the logic moved from game.controller.ts)
   */
  async createAICardCopies(playerCardInstanceIds: string[]): Promise<string[]> {
    const aiCardInstanceIds: string[] = [];
    for (const playerInstanceId of playerCardInstanceIds) {
      const cardQuery = `
        SELECT card_variant_id, level FROM "user_owned_cards"
        WHERE user_card_instance_id = $1;
      `;
      const { rows: cardDetails } = await db.query(cardQuery, [
        playerInstanceId,
      ]);

      if (cardDetails.length > 0) {
        const { card_variant_id, level } = cardDetails[0];
        const insertQuery = `
          INSERT INTO "user_owned_cards" (user_id, card_variant_id, level, xp, created_at)
          VALUES ($1, $2, $3, 0, NOW())
          RETURNING user_card_instance_id;
        `;
        const { rows: insertRows } = await db.query(insertQuery, [
          AI_PLAYER_ID,
          card_variant_id,
          level,
        ]);
        if (insertRows.length > 0) {
          aiCardInstanceIds.push(insertRows[0].user_card_instance_id);
        }
      }
    }
    return aiCardInstanceIds;
  }
}

export default new DeckService();
