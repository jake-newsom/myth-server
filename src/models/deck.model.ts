import { PoolClient } from "pg";
import db from "../config/db.config";
import { Deck, DeckWithCards } from "../types/database.types";

const DeckModel = {
  // Creates a deck and its cards within a transaction using a provided client
  async createWithClient(
    client: PoolClient,
    userId: string,
    deckName: string,
    userCardInstanceIds: string[]
  ): Promise<DeckWithCards> {
    const deckQuery = `
      INSERT INTO "Decks" (user_id, name, created_at, updated_at)
      VALUES ($1, $2, NOW(), NOW())
      RETURNING deck_id, name, user_id, created_at, updated_at;
    `;
    const deckResult = await client.query(deckQuery, [userId, deckName]);
    const deck = deckResult.rows[0] as Deck;

    if (userCardInstanceIds && userCardInstanceIds.length > 0) {
      const cardInsertPromises = userCardInstanceIds.map((instanceId) => {
        const deckCardQuery = `
          INSERT INTO "DeckCards" (deck_id, user_card_instance_id)
          VALUES ($1, $2);
        `;
        return client.query(deckCardQuery, [deck.deck_id, instanceId]);
      });
      await Promise.all(cardInsertPromises);
    }

    // Return the basic deck info + instance IDs
    return {
      deck_id: deck.deck_id,
      name: deck.name,
      user_id: deck.user_id,
      created_at: deck.created_at,
      updated_at: deck.updated_at,
      user_card_instance_ids: userCardInstanceIds,
    };
  },

  // Add other deck methods (find, update, delete) in Phase 3
};

export default DeckModel;
