import db from "../config/db.config";
// Ensure AI_PLAYER_ID is accessible. If game.controller.ts exports it, use that.
// For now, assuming it will be imported from controller or a constants file.
// Let's adjust the import based on where AI_PLAYER_ID is defined.
// If it's exported from game.controller.ts:
import { AI_PLAYER_ID } from "../api/controllers/game.controller";
import { DeckEffectType } from "../types/game.types";

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
   * Calculates the average total power across all cards in a deck.
   * Total power per card = sum of base_power (top+bottom+left+right) + power_up enhancements.
   * Returns null if the deck has no cards.
   */
  async getDeckAveragePower(deckId: string): Promise<number | null> {
    const query = `
      SELECT AVG(
        (ch.base_power->>'top')::int + (ch.base_power->>'bottom')::int +
        (ch.base_power->>'left')::int + (ch.base_power->>'right')::int +
        COALESCE((pup.power_up_data->>'top')::int, 0) +
        COALESCE((pup.power_up_data->>'bottom')::int, 0) +
        COALESCE((pup.power_up_data->>'left')::int, 0) +
        COALESCE((pup.power_up_data->>'right')::int, 0)
      ) as avg_power
      FROM deck_cards dc
      JOIN user_owned_cards uoc ON dc.user_card_instance_id = uoc.user_card_instance_id
      JOIN card_variants cv ON uoc.card_variant_id = cv.card_variant_id
      JOIN characters ch ON cv.character_id = ch.character_id
      LEFT JOIN user_card_power_ups pup ON uoc.user_card_instance_id = pup.user_card_instance_id
      WHERE dc.deck_id = $1;
    `;
    const { rows } = await db.query(query, [deckId]);
    if (rows.length === 0 || rows[0].avg_power === null) {
      return null;
    }
    return parseFloat(rows[0].avg_power);
  }

  /**
   * Finds an AI deck whose average power is within ±tolerance of the target.
   * If no deck falls within range, returns the closest AI deck by average power.
   * Falls back to a fully random AI deck if power data is unavailable.
   */
  async getBalancedAIDeckId(
    targetAvgPower: number,
    tolerance: number = 3
  ): Promise<string | null> {
    const query = `
      WITH ai_deck_powers AS (
        SELECT dc.deck_id, AVG(
          (ch.base_power->>'top')::int + (ch.base_power->>'bottom')::int +
          (ch.base_power->>'left')::int + (ch.base_power->>'right')::int +
          COALESCE((pup.power_up_data->>'top')::int, 0) +
          COALESCE((pup.power_up_data->>'bottom')::int, 0) +
          COALESCE((pup.power_up_data->>'left')::int, 0) +
          COALESCE((pup.power_up_data->>'right')::int, 0)
        ) as avg_power
        FROM deck_cards dc
        JOIN decks d ON dc.deck_id = d.deck_id
        JOIN user_owned_cards uoc ON dc.user_card_instance_id = uoc.user_card_instance_id
        JOIN card_variants cv ON uoc.card_variant_id = cv.card_variant_id
        JOIN characters ch ON cv.character_id = ch.character_id
        LEFT JOIN user_card_power_ups pup ON uoc.user_card_instance_id = pup.user_card_instance_id
        WHERE d.user_id = $1
        GROUP BY dc.deck_id
        HAVING COUNT(dc.deck_card_id) > 0
      )
      SELECT deck_id, avg_power, ABS(avg_power - $2) as power_diff
      FROM ai_deck_powers
      ORDER BY
        CASE WHEN avg_power BETWEEN $3 AND $4 THEN 0 ELSE 1 END,
        RANDOM()
      LIMIT 1;
    `;

    const lowerBound = targetAvgPower - tolerance;
    const upperBound = targetAvgPower + tolerance;
    const { rows } = await db.query(query, [
      AI_PLAYER_ID,
      targetAvgPower,
      lowerBound,
      upperBound,
    ]);

    if (rows.length === 0) {
      return this.getRandomAIDeckId();
    }

    return rows[0].deck_id;
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
   * Gets the dominant mythology (set) of a deck by counting the most common set.
   * Returns the set name, or null if the deck is empty or has no sets.
   */
  async getDeckDominantMythology(deckId: string): Promise<string | null> {
    const query = `
      SELECT s.name, COUNT(*) as count
      FROM deck_cards dc
      JOIN user_owned_cards uoc ON dc.user_card_instance_id = uoc.user_card_instance_id
      JOIN card_variants cv ON uoc.card_variant_id = cv.card_variant_id
      JOIN characters ch ON cv.character_id = ch.character_id
      JOIN sets s ON ch.set_id = s.set_id
      WHERE dc.deck_id = $1
      GROUP BY s.name
      ORDER BY count DESC
      LIMIT 1;
    `;
    const { rows } = await db.query(query, [deckId]);
    return rows.length > 0 ? rows[0].name : null;
  }

  /**
   * Creates AI card copies based on player's card instances.
   * (This is the logic moved from game.controller.ts)
   */
  async createAICardCopies(playerCardInstanceIds: string[]): Promise<string[]> {
    if (playerCardInstanceIds.length === 0) {
      return [];
    }

    const sourceCardsQuery = `
      SELECT
        req.ord,
        uoc.card_variant_id,
        uoc.level
      FROM UNNEST($1::uuid[]) WITH ORDINALITY AS req(user_card_instance_id, ord)
      JOIN "user_owned_cards" uoc
        ON uoc.user_card_instance_id = req.user_card_instance_id
      ORDER BY req.ord;
    `;
    const { rows: sourceCards } = await db.query(sourceCardsQuery, [
      playerCardInstanceIds,
    ]);
    if (sourceCards.length === 0) {
      return [];
    }

    const insertQuery = `
      INSERT INTO "user_owned_cards" (user_id, card_variant_id, level, xp, created_at)
      SELECT
        $1::uuid,
        data.card_variant_id,
        data.level,
        0,
        NOW()
      FROM UNNEST($2::uuid[], $3::int[]) AS data(card_variant_id, level)
      RETURNING user_card_instance_id;
    `;
    const { rows: insertedRows } = await db.query(insertQuery, [
      AI_PLAYER_ID,
      sourceCards.map((card) => card.card_variant_id),
      sourceCards.map((card) => card.level),
    ]);

    return insertedRows.map((row) => row.user_card_instance_id);
  }

  /**
   * Gets the deck effect type based on mythology composition.
   * Returns the effect type if a single mythology has at least minCount cards.
   * Supported mythologies: Norse, Polynesian, Japanese
   * 
   * @param deckId - The deck ID to analyze
   * @param minCount - Minimum cards of a single mythology required (default: 12)
   * @returns The deck effect type or null if no mythology meets the threshold
   */
  async getDeckEffect(
    deckId: string,
    minCount: number = 12
  ): Promise<DeckEffectType | null> {
    const query = `
      SELECT LOWER(s.name) as set_name, COUNT(*) as count
      FROM deck_cards dc
      JOIN user_owned_cards uoc ON dc.user_card_instance_id = uoc.user_card_instance_id
      JOIN card_variants cv ON uoc.card_variant_id = cv.card_variant_id
      JOIN characters ch ON cv.character_id = ch.character_id
      JOIN sets s ON ch.set_id = s.set_id
      WHERE dc.deck_id = $1
      GROUP BY s.name
      HAVING COUNT(*) >= $2
      ORDER BY count DESC
      LIMIT 1;
    `;
    const { rows } = await db.query(query, [deckId, minCount]);

    if (rows.length === 0) {
      return null;
    }

    const setName = rows[0].set_name as string;

    // Map set names to deck effect types
    if (setName === "norse") {
      return "norse";
    } else if (setName === "polynesian") {
      return "polynesian";
    } else if (setName === "japanese") {
      return "japanese";
    }

    // Other mythologies don't have deck effects yet
    return null;
  }

  /**
   * Gets all rare variant cards (+/++/+++) from a deck.
   * Returns card_variant_id, name, rarity, and image_url for each rare variant found.
   * 
   * @param deckId - The deck ID to search for rare cards
   * @returns Array of rare variant cards from the deck
   */
  async getRareVariantCardsFromDeck(deckId: string): Promise<
    { card_variant_id: string; name: string; rarity: string; image_url: string }[]
  > {
    const query = `
      SELECT DISTINCT cv.card_variant_id, ch.name, cv.rarity::text as rarity, cv.image_url
      FROM deck_cards dc
      JOIN user_owned_cards uoc ON dc.user_card_instance_id = uoc.user_card_instance_id
      JOIN card_variants cv ON uoc.card_variant_id = cv.card_variant_id
      JOIN characters ch ON cv.character_id = ch.character_id
      WHERE dc.deck_id = $1
        AND POSITION('+' IN cv.rarity::text) > 0
        AND cv.is_exclusive = false;
    `;
    const { rows } = await db.query(query, [deckId]);
    return rows;
  }
}

export default new DeckService();
