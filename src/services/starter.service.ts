import { PoolClient } from "pg";
import db from "../config/db.config";
import DeckModel from "../models/deck.model";

// Define Starter Content (IDs should match those in your Cards table after seeding)
const STARTER_BASE_CARD_NAMES_AND_QUANTITIES: {
  name: string;
  quantity: number;
}[] = [
  { name: "Valkyrie", quantity: 1 },
  { name: "Draugr", quantity: 1 },
  { name: "Thunder Priest", quantity: 1 },
  { name: "Ratatoskr", quantity: 1 },
  { name: "Shield Maiden", quantity: 2 },
  { name: "Thrall", quantity: 2 },
  { name: "Drengr", quantity: 2 },
  { name: "Peasant Archer", quantity: 2 },
  { name: "Wolf Pup", quantity: 2 },
  { name: "Boar of the Hunt", quantity: 2 },
  { name: "Skald", quantity: 2 },
  { name: "Young Jarl", quantity: 2 },
]; // This list results in 20 card instances for the deck, respecting legendary limits.

const STARTER_DECK_CONFIG = {
  name: "Norse Warriors Starter Deck",
};

const StarterService = {
  async grantStarterContent(userId: string): Promise<void> {
    const client: PoolClient = await db.getClient();
    try {
      await client.query("BEGIN");

      // 1. Get actual card_ids for starter card names
      const baseCardNames = STARTER_BASE_CARD_NAMES_AND_QUANTITIES.map(
        (c) => c.name
      );
      const cardNamePlaceholders = baseCardNames
        .map((_, i) => `$${i + 1}`)
        .join(",");

      const cardRes = await client.query(
        `SELECT card_id, name, rarity FROM "cards" WHERE name IN (${cardNamePlaceholders});`,
        baseCardNames
      );
      const cardIdMap = new Map<string, { card_id: string; rarity: string }>(
        cardRes.rows.map((card) => [
          card.name,
          { card_id: card.card_id, rarity: card.rarity },
        ])
      );

      if (cardRes.rows.length !== baseCardNames.length) {
        console.warn(
          "Not all starter base cards found in DB. Check STARTER_BASE_CARD_NAMES_AND_QUANTITIES.",
          cardRes.rows.map((r) => r.name)
        );
        // Potentially throw an error or handle gracefully
      }

      // 2. Create UserCardInstance records for each copy of starter cards
      const createdCardInstanceIds: string[] = [];
      for (const cardInfo of STARTER_BASE_CARD_NAMES_AND_QUANTITIES) {
        const baseCardDetails = cardIdMap.get(cardInfo.name);
        if (baseCardDetails) {
          for (let i = 0; i < cardInfo.quantity; i++) {
            // Create a new instance for each copy
            const instanceRes = await client.query(
              'INSERT INTO "user_owned_cards" (user_id, card_id, level, xp) VALUES ($1, $2, 1, 0) RETURNING user_card_instance_id;',
              [userId, baseCardDetails.card_id]
            );
            createdCardInstanceIds.push(
              instanceRes.rows[0].user_card_instance_id
            );
          }
        }
      }
      console.log(
        `Granted ${createdCardInstanceIds.length} starter card instances to user ${userId}`
      );

      // 3. Create starter deck using the newly created card instances
      // This simplified implementation assumes the createdCardInstanceIds are already chosen for the deck
      // and that the list of STARTER_BASE_CARD_NAMES_AND_QUANTITIES is designed to create a valid 20-card deck

      if (createdCardInstanceIds.length !== 20) {
        console.warn(
          `Starter deck for user ${userId} will not have exactly 20 cards. Has ${createdCardInstanceIds.length} cards.`
        );
      }

      // Take up to 20 instances for the deck
      const deckInstancesForCreation = createdCardInstanceIds.slice(0, 20);

      await DeckModel.createWithClient(
        client,
        userId,
        STARTER_DECK_CONFIG.name,
        deckInstancesForCreation
      );
      console.log(
        `Created starter deck "${STARTER_DECK_CONFIG.name}" for user ${userId} with ${deckInstancesForCreation.length} cards.`
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Error granting starter content:", error);
      throw error; // Re-throw to be caught by controller
    } finally {
      client.release();
    }
  },
};

export default StarterService;
