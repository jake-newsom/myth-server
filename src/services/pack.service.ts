import CardModel from "../models/card.model";
import SetModel from "../models/set.model";
import UserModel from "../models/user.model";
import { Card, SpecialAbility } from "../types/database.types";

const CARDS_PER_PACK = 5;

interface CardWithAbility extends Card {
  special_ability: {
    ability_id: string;
    name: string;
    description: string;
    triggerMoment: string;
    parameters: Record<string, any>;
  } | null;
}

interface PackOpenResult {
  cards: CardWithAbility[];
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

    // 7. Log the pack opening to history
    await this.logPackOpening(userId, setId, selectedCards);

    // 8. Trigger achievement events for pack opening
    try {
      const AchievementService = await import("./achievement.service");

      // Pack opened event
      await AchievementService.default.triggerAchievementEvent({
        userId,
        eventType: "pack_opened",
        eventData: {
          setId,
          cardsReceived: selectedCards,
          packsRemaining: updatedUser.pack_count,
        },
      });

      // Card collection events for each unique card
      for (const card of selectedCards) {
        await AchievementService.default.triggerAchievementEvent({
          userId,
          eventType: "card_collected",
          eventData: {
            cardId: card.card_id,
            cardName: card.name,
            rarity: card.rarity,
            // TODO: Calculate total unique cards for card_master achievement
            totalUniqueCards: 0,
          },
        });
      }
    } catch (error) {
      console.error("Error processing pack opening achievement events:", error);
      // Don't fail the pack opening process if achievement processing fails
    }

    // 9. Create fate pick opportunity from this pack opening
    try {
      const FatePickService = await import("./fatePick.service");

      // Get the pack opening ID from the history
      const packOpeningQuery = `
        SELECT pack_opening_id FROM pack_opening_history 
        WHERE user_id = $1 
        ORDER BY opened_at DESC 
        LIMIT 1;
      `;
      const db = require("../config/db.config").default;
      const { rows: packRows } = await db.query(packOpeningQuery, [userId]);

      if (packRows.length > 0) {
        const packOpeningId = packRows[0].pack_opening_id;

        // Create fate pick with 1 wonder coin cost
        await FatePickService.default.createFatePickFromPackOpening(
          packOpeningId,
          userId,
          selectedCards,
          setId,
          1 // Cost in wonder coins
        );
      }
    } catch (error) {
      console.error("Error creating fate pick from pack opening:", error);
      // Don't fail the pack opening process if fate pick creation fails
    }

    return {
      cards: selectedCards,
      remainingPacks: updatedUser.pack_count,
    };
  },

  async getCardsFromSet(setId: string): Promise<CardWithAbility[]> {
    // This would need to be implemented in CardModel
    // For now, we'll create a simple query here
    const db = require("../config/db.config").default;
    const query = `
      SELECT 
        c.card_id, c.name, c.rarity, c.image_url, 
        c.power->>'top' as base_power_top,
        c.power->>'right' as base_power_right, 
        c.power->>'bottom' as base_power_bottom, 
        c.power->>'left' as base_power_left,
        c.special_ability_id, c.set_id, c.tags,
        sa.ability_id as sa_ability_id, sa.name as sa_name, sa.description as sa_description,
        sa.trigger_moment as sa_trigger_moment, sa.parameters as sa_parameters
      FROM "cards" c
      LEFT JOIN "special_abilities" sa ON c.special_ability_id = sa.ability_id
      WHERE c.set_id = $1;
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
      special_ability: row.sa_ability_id
        ? {
            ability_id: row.sa_ability_id,
            name: row.sa_name,
            description: row.sa_description,
            triggerMoment: row.sa_trigger_moment,
            parameters: row.sa_parameters,
          }
        : null,
    }));
  },

  selectRandomCards(
    cards: CardWithAbility[],
    count: number
  ): CardWithAbility[] {
    // Group cards by rarity
    const cardsByRarity: { [key: string]: CardWithAbility[] } = {};
    cards.forEach((card) => {
      if (!cardsByRarity[card.rarity]) {
        cardsByRarity[card.rarity] = [];
      }
      cardsByRarity[card.rarity].push(card);
    });

    const selectedCards: CardWithAbility[] = [];

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

  async addCardsToUserCollection(
    userId: string,
    cards: CardWithAbility[]
  ): Promise<void> {
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

  async logPackOpening(
    userId: string,
    setId: string,
    cards: CardWithAbility[]
  ): Promise<void> {
    const db = require("../config/db.config").default;

    // Extract card IDs for storage
    const cardIds = cards.map((card) => card.card_id);

    const query = `
      INSERT INTO "pack_opening_history" (user_id, set_id, card_ids)
      VALUES ($1, $2, $3);
    `;

    await db.query(query, [userId, setId, JSON.stringify(cardIds)]);
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
