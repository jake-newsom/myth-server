import { PoolClient } from "pg";
import db from "../config/db.config";
import DeckModel from "../models/deck.model";
import UserModel from "../models/user.model";

const STARTER_BASE_CARD_NAMES_AND_QUANTITIES: {
  name: string;
  quantity: number;
}[] = [
  { name: "Shieldmaiden", quantity: 2 },
  { name: "Drenger", quantity: 2 },
  { name: "Bear Totem", quantity: 2 },
  { name: "Torchbearer", quantity: 2 },
  { name: "Raven Scout", quantity: 2 },
  { name: "Ice Fisher", quantity: 2 },
  { name: "Peasant Archer", quantity: 2 },
  { name: "Norse Fox", quantity: 2 },
  { name: "Runestone Keeper", quantity: 2 },
  { name: "Young Jarl", quantity: 2 },
];

const STARTER_DECK_CONFIG = {
  name: "Norse Starter Deck",
};

const STARTER_PACKS_QUANTITY = 10; // Temporarily increased for testing - will be reduced before launch

const StarterService = {
  async grantStarterCards(
    client: PoolClient,
    userId: string
  ): Promise<string[]> {
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
    }

    const createdCardInstanceIds: string[] = [];
    for (const cardInfo of STARTER_BASE_CARD_NAMES_AND_QUANTITIES) {
      const baseCardDetails = cardIdMap.get(cardInfo.name);
      if (baseCardDetails) {
        for (let i = 0; i < cardInfo.quantity; i++) {
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

    if (createdCardInstanceIds.length !== 20) {
      console.warn(
        `Starter cards for user ${userId} will not have exactly 20 cards. Has ${createdCardInstanceIds.length} cards.`
      );
    }

    return createdCardInstanceIds;
  },

  async createStarterDeck(
    client: PoolClient,
    userId: string,
    cardInstanceIds: string[]
  ): Promise<void> {
    const deckInstancesForCreation = cardInstanceIds.slice(0, 20);

    await DeckModel.createWithClient(
      client,
      userId,
      STARTER_DECK_CONFIG.name,
      deckInstancesForCreation
    );
  },

  async grantStarterPacks(userId: string): Promise<void> {
    const updatedUser = await UserModel.addPacks(
      userId,
      STARTER_PACKS_QUANTITY
    );
    if (!updatedUser) {
      throw new Error(
        `Failed to grant ${STARTER_PACKS_QUANTITY} starter packs to user ${userId}`
      );
    }
  },

  async grantStarterContent(userId: string): Promise<void> {
    const client: PoolClient = await db.getClient();
    try {
      await client.query("BEGIN");

      const cardInstanceIds = await this.grantStarterCards(client, userId);
      await this.createStarterDeck(client, userId, cardInstanceIds);

      await client.query("COMMIT");

      // Packs granted outside transaction since UserModel.addPacks handles its own transaction
      await this.grantStarterPacks(userId);
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Error granting starter content:", error);
      throw error;
    } finally {
      client.release();
    }
  },
};

export default StarterService;
