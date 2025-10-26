import { PoolClient } from "pg";
import db from "../config/db.config";
import {
  Deck,
  DeckCard,
  UserCardInstance,
  Card as BaseCard,
  SpecialAbility,
} from "../types/database.types";
import { DeckDetailResponse, CardResponse } from "../types/api.types"; // For formatting output
import CardModel from "./card.model"; // For fetching base card details for validation
import { PowerValues } from "../types/card.types"; // Import PowerValues if needed, though CardResponse includes it

// Helper to format card instances for deck response (similar to the one in CardModel)
const formatDeckCardInstanceResponse = (
  baseCard: BaseCard,
  instance: UserCardInstance,
  ability: SpecialAbility | null
): CardResponse => {
  return {
    user_card_instance_id: instance.user_card_instance_id,
    base_card_id: baseCard.card_id,
    name: baseCard.name,
    rarity: baseCard.rarity,
    image_url: baseCard.image_url,
    base_power: baseCard.base_power,
    level: instance.level,
    xp: instance.xp,
    power_enhancements: instance.power_enhancements,
    tags: baseCard.tags,
    set_id: baseCard.set_id || null,
    special_ability: ability
      ? {
          ability_id: ability.ability_id,
          name: ability.name,
          description: ability.description,
          triggerMoment: ability.triggerMoment,
          parameters: ability.parameters,
        }
      : null,
  };
};

const DeckModel = {
  // Creates a deck and its cards within a transaction using a provided client
  async createWithClient(
    client: PoolClient,
    userId: string,
    deckName: string,
    userCardInstanceIds: string[]
  ): Promise<DeckDetailResponse> {
    const deckQuery = `
      INSERT INTO "decks" (user_id, name, created_at, last_updated)
      VALUES ($1, $2, NOW(), NOW())
      RETURNING deck_id, name, user_id, created_at, last_updated;
    `;
    const deckResult = await client.query(deckQuery, [userId, deckName]);
    const deck = deckResult.rows[0];

    if (userCardInstanceIds && userCardInstanceIds.length > 0) {
      const cardInsertPromises = userCardInstanceIds.map((instanceId) => {
        const deckCardQuery = `
          INSERT INTO "deck_cards" (deck_id, user_card_instance_id)
          VALUES ($1, $2);
        `;
        return client.query(deckCardQuery, [deck.deck_id, instanceId]);
      });
      await Promise.all(cardInsertPromises);
    }
    const deckDetails = await this.findDeckWithInstanceDetails(
      deck.deck_id,
      userId,
      client
    );
    if (!deckDetails) {
      // This should never happen since we just created the deck
      throw new Error("Failed to retrieve created deck details");
    }
    return deckDetails;
  },

  async findAllByUserId(userId: string): Promise<DeckDetailResponse[]> {
    // Query to get all deck IDs for this user
    const deckIdsQuery = `
      SELECT deck_id
      FROM "decks"
      WHERE user_id = $1
      ORDER BY last_updated DESC;
    `;
    const deckIdsResult = await db.query(deckIdsQuery, [userId]);

    // For each deck ID, get the full deck details with cards
    const deckPromises = deckIdsResult.rows.map((row) =>
      this.findDeckWithInstanceDetails(row.deck_id, userId)
    );

    // Wait for all promises to resolve
    const decks = await Promise.all(deckPromises);

    // Filter out any null results (shouldn't happen, but just in case)
    return decks.filter((deck) => deck !== null) as DeckDetailResponse[];
  },

  async findDeckWithInstanceDetails(
    deckId: string,
    userId: string,
    client: PoolClient | typeof db = db
  ): Promise<DeckDetailResponse | null> {
    const deckQuery = `
      SELECT deck_id, name, user_id, created_at, last_updated
      FROM "decks"
      WHERE deck_id = $1 AND user_id = $2;
    `;
    const deckResult = await client.query(deckQuery, [deckId, userId]);
    if (deckResult.rows.length === 0) {
      return null;
    }
    const deckInfo = deckResult.rows[0];

    const cardsQuery = `
      SELECT
        dc.user_card_instance_id,
        uci.level, uci.xp, uci.card_id AS base_card_id,
        c.name, c.rarity, c.image_url,
        c.power->>'top' as base_power_top,
        c.power->>'right' as base_power_right, 
        c.power->>'bottom' as base_power_bottom, 
        c.power->>'left' as base_power_left,
        c.special_ability_id, c.set_id, c.tags,
        sa.name as ability_name, sa.description as ability_description, 
        sa.trigger_moment as ability_trigger, sa.parameters as ability_parameters,
        sa.id as ability_id_string
      FROM "deck_cards" dc
      JOIN "user_owned_cards" uci ON dc.user_card_instance_id = uci.user_card_instance_id
      JOIN "cards" c ON uci.card_id = c.card_id
      LEFT JOIN "special_abilities" sa ON c.special_ability_id = sa.ability_id
      WHERE dc.deck_id = $1 AND uci.user_id = $2
      ORDER BY c.name;
    `;
    const cardsResult = await client.query(cardsQuery, [deckId, userId]);

    const cardDetails = cardsResult.rows.map((row) => {
      const baseCard: BaseCard = {
        card_id: row.base_card_id,
        name: row.name,
        rarity: row.rarity,
        image_url: row.image_url,
        base_power: {
          top: parseInt(row.base_power_top, 10),
          right: parseInt(row.base_power_right, 10),
          bottom: parseInt(row.base_power_bottom, 10),
          left: parseInt(row.base_power_left, 10),
        },
        special_ability_id: row.special_ability_id,
        set_id: row.set_id,
        tags: row.tags,
      };
      const instance: UserCardInstance = {
        user_card_instance_id: row.user_card_instance_id,
        user_id: userId,
        card_id: row.base_card_id,
        level: row.level,
        xp: row.xp,
        power_enhancements: {
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
        },
      };
      const ability: SpecialAbility | null = row.special_ability_id
        ? {
            ability_id: row.special_ability_id,
            id: row.ability_id_string || row.special_ability_id,
            name: row.ability_name,
            description: row.ability_description,
            triggerMoment: row.ability_trigger,
            parameters: row.ability_parameters,
          }
        : null;
      return formatDeckCardInstanceResponse(baseCard, instance, ability);
    });

    return { ...deckInfo, cards: cardDetails };
  },

  async updateWithClient(
    client: PoolClient,
    deckId: string,
    userId: string,
    deckName: string | undefined,
    userCardInstanceIds: string[] | undefined
  ): Promise<DeckDetailResponse | null> {
    const ownerCheck = await client.query(
      'SELECT user_id FROM "decks" WHERE deck_id = $1;',
      [deckId]
    );
    if (ownerCheck.rows.length === 0 || ownerCheck.rows[0].user_id !== userId) {
      const error: any = new Error(
        "Deck not found or user does not own this deck."
      );
      error.statusCode = 404;
      throw error;
    }

    if (deckName !== undefined) {
      await client.query(
        'UPDATE "decks" SET name = $1, last_updated = NOW() WHERE deck_id = $2;',
        [deckName, deckId]
      );
    } else {
      await client.query(
        'UPDATE "decks" SET last_updated = NOW() WHERE deck_id = $1;',
        [deckId]
      );
    }

    if (userCardInstanceIds) {
      // If new set of instances is provided, replace old ones
      await client.query('DELETE FROM "deck_cards" WHERE deck_id = $1;', [
        deckId,
      ]);
      if (userCardInstanceIds.length > 0) {
        const cardInsertPromises = userCardInstanceIds.map((instanceId) => {
          return client.query(
            'INSERT INTO "deck_cards" (deck_id, user_card_instance_id) VALUES ($1, $2);',
            [deckId, instanceId]
          );
        });
        await Promise.all(cardInsertPromises);
      }
    }
    return this.findDeckWithInstanceDetails(deckId, userId, client);
  },

  async delete(deckId: string, userId: string): Promise<boolean> {
    const client = await db.getClient();
    try {
      await client.query("BEGIN");

      // Verify ownership
      const ownerCheck = await client.query(
        'SELECT user_id FROM "decks" WHERE deck_id = $1;',
        [deckId]
      );
      if (
        ownerCheck.rows.length === 0 ||
        ownerCheck.rows[0].user_id !== userId
      ) {
        await client.query("ROLLBACK");
        return false;
      }

      // Delete the deck and its references
      await client.query('DELETE FROM "deck_cards" WHERE deck_id = $1;', [
        deckId,
      ]);
      await client.query('DELETE FROM "decks" WHERE deck_id = $1;', [deckId]);

      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
};

export default DeckModel;
