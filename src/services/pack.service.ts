import CardModel from "../models/card.model";
import SetModel from "../models/set.model";
import UserModel from "../models/user.model";
import { Card } from "../types/database.types";

const CARDS_PER_PACK = 5;

interface PackOpenResult {
  cards: Card[];
  remainingPacks: number;
}

const PackService = {
  async openPack(
    userId: string,
    setId: string
  ): Promise<PackOpenResult | null> {
    // 1. Verify the set exists and is released
    const set = await SetModel.findById(setId);
    if (!set || !set.is_released) {
      throw new Error("Set is not available for pack opening");
    }

    // 2. Check if user has at least one pack
    const userPackCount = await UserModel.getPackCount(userId);
    if (userPackCount < 1) {
      throw new Error("User does not have any packs available");
    }

    // 3. Get all cards from this set
    const setCards = await this.getCardsFromSet(setId);
    if (setCards.length === 0) {
      throw new Error("No cards available in this set");
    }

    // 4. Randomly select 5 cards (with replacement allowed)
    const selectedCards = this.selectRandomCards(setCards, CARDS_PER_PACK);

    // 5. Remove one pack from user's total pack count
    const updatedUser = await UserModel.removePacks(userId, 1);
    if (!updatedUser) {
      throw new Error("Failed to remove pack from user inventory");
    }

    // 6. Add the selected cards to user's collection
    await this.addCardsToUserCollection(userId, selectedCards);

    return {
      cards: selectedCards,
      remainingPacks: updatedUser.pack_count,
    };
  },

  async getCardsFromSet(setId: string): Promise<Card[]> {
    // This would need to be implemented in CardModel
    // For now, we'll create a simple query here
    const db = require("../config/db.config").default;
    const query = `
      SELECT 
        card_id, name, rarity, image_url, 
        power->>'top' as base_power_top,
        power->>'right' as base_power_right, 
        power->>'bottom' as base_power_bottom, 
        power->>'left' as base_power_left,
        special_ability_id, set_id, tags
      FROM "cards"
      WHERE set_id = $1;
    `;
    const { rows } = await db.query(query, [setId]);

    return rows.map((row: any) => ({
      card_id: row.card_id,
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
    }));
  },

  selectRandomCards(cards: Card[], count: number): Card[] {
    const selectedCards: Card[] = [];

    for (let i = 0; i < count; i++) {
      const randomIndex = Math.floor(Math.random() * cards.length);
      selectedCards.push(cards[randomIndex]);
    }

    return selectedCards;
  },

  async addCardsToUserCollection(userId: string, cards: Card[]): Promise<void> {
    const db = require("../config/db.config").default;

    // Insert each card into user's collection
    for (const card of cards) {
      const query = `
        INSERT INTO "user_owned_cards" (user_id, card_id, level, xp, created_at)
        VALUES ($1, $2, 1, 0, NOW());
      `;
      await db.query(query, [userId, card.card_id]);
    }
  },

  async getPackRarityWeights(): Promise<{ [key: string]: number }> {
    // Define rarity weights for pack opening
    // Higher numbers = more likely to appear
    return {
      common: 50,
      uncommon: 30,
      rare: 15,
      epic: 4,
      legendary: 1,
    };
  },

  selectRandomCardsWithRarity(cards: Card[], count: number): Card[] {
    // Group cards by rarity
    const cardsByRarity: { [key: string]: Card[] } = {};
    cards.forEach((card) => {
      if (!cardsByRarity[card.rarity]) {
        cardsByRarity[card.rarity] = [];
      }
      cardsByRarity[card.rarity].push(card);
    });

    const selectedCards: Card[] = [];

    for (let i = 0; i < count; i++) {
      // Select a rarity based on weights
      const rarity = this.selectWeightedRarity();

      // If no cards of that rarity exist, fall back to any available card
      const availableCards = cardsByRarity[rarity] || cards;
      if (availableCards.length > 0) {
        const randomIndex = Math.floor(Math.random() * availableCards.length);
        selectedCards.push(availableCards[randomIndex]);
      }
    }

    return selectedCards;
  },

  selectWeightedRarity(): string {
    const weights = {
      common: 50,
      uncommon: 30,
      rare: 15,
      epic: 4,
      legendary: 1,
    };

    const totalWeight = Object.values(weights).reduce(
      (sum, weight) => sum + weight,
      0
    );
    let random = Math.random() * totalWeight;

    for (const [rarity, weight] of Object.entries(weights)) {
      random -= weight;
      if (random <= 0) {
        return rarity;
      }
    }

    return "common"; // fallback
  },
};

export default PackService;
