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

    // 2. Check if the set has cards available
    const setCardsCount = await this.getSetCardCount(setId);
    if (setCardsCount === 0) {
      throw new Error("No cards available in this set");
    }

    // 3. Check if user has at least one pack
    const userPackCount = await UserModel.getPackCount(userId);
    if (userPackCount < 1) {
      throw new Error("User does not have any packs available");
    }

    // 4. Get all cards from this set
    const setCards = await this.getCardsFromSet(setId);
    if (setCards.length === 0) {
      throw new Error("No cards available in this set");
    }

    // 5. Randomly select 5 cards (with replacement allowed)
    const selectedCards = this.selectRandomCards(setCards, CARDS_PER_PACK);

    // 6. Remove one pack from user's total pack count
    const updatedUser = await UserModel.removePacks(userId, 1);
    if (!updatedUser) {
      throw new Error("Failed to remove pack from user inventory");
    }

    // 7. Add the selected cards to user's collection
    await this.addCardsToUserCollection(userId, selectedCards);

    // 8. Log the pack opening to history
    await this.logPackOpening(userId, setId, selectedCards);

    // 9. Trigger achievement events for pack opening
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
            // Ensure totalUniqueCards is always a number (0 is falsy but valid)
            totalUniqueCards: 0, // Will be calculated in future implementation
          },
        });
      }
    } catch (error) {
      console.error("Error processing pack opening achievement events:", error);
      // Don't fail the pack opening process if achievement processing fails
    }

    // 10. Create fate pick opportunity from this pack opening
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

  async openMultiplePacks(userId: string, setId: string, count: number) {
    // 1. Verify the set exists and is released
    const set = await SetModel.findById(setId);
    if (!set || !set.is_released) {
      return {
        success: false,
        message: "Set is not available for pack opening",
      };
    }

    // 2. Check if the set has cards available
    const setCardsCount = await this.getSetCardCount(setId);
    if (setCardsCount === 0) {
      return {
        success: false,
        message: "No cards available in this set",
      };
    }

    // 3. Check how many packs the user owns
    const userPackCount = await UserModel.getPackCount(userId);
    let packsToUse = Math.min(userPackCount, count);
    let packsToBuy = Math.max(0, count - userPackCount);
    let requiredGems = 0;
    let discount = 1;
    if (packsToBuy > 0) {
      requiredGems = packsToBuy * 100;
      if (count >= 10) {
        discount = 0.9;
        requiredGems = Math.floor(requiredGems * discount);
      }
      // Check if user has enough gems
      const user = await UserModel.findById(userId);
      if (!user || user.gems < requiredGems) {
        return {
          success: false,
          message: "Not enough resources to purchase packs",
        };
      }
    }
    // If not enough packs and not enough gems, fail
    if (packsToUse + packsToBuy < count) {
      return {
        success: false,
        message: "Not enough resources to purchase packs",
      };
    }

    // Remove packs and gems as needed
    if (packsToUse > 0) {
      const removed = await UserModel.removePacks(userId, packsToUse);
      if (!removed) {
        return {
          success: false,
          message: "Failed to remove packs from user inventory",
        };
      }
    }
    if (packsToBuy > 0) {
      const spent = await UserModel.spendGems(userId, requiredGems);
      if (!spent) {
        return { success: false, message: "Failed to spend gems" };
      }
    }

    // Open the packs - but don't use openPack directly as it checks pack count each time
    const packs: any[] = [];

    try {
      // Get all cards from this set
      const setCards = await this.getCardsFromSet(setId);
      if (setCards.length === 0) {
        throw new Error("No cards available in this set");
      }

      // Process each pack
      for (let i = 0; i < count; i++) {
        // Select cards for this pack
        const selectedCards = this.selectRandomCards(setCards, CARDS_PER_PACK);

        // Add the selected cards to user's collection
        await this.addCardsToUserCollection(userId, selectedCards);

        // Log the pack opening to history
        await this.logPackOpening(userId, setId, selectedCards);

        // Trigger achievement events for pack opening
        try {
          const AchievementService = await import("./achievement.service");

          // Pack opened event
          await AchievementService.default.triggerAchievementEvent({
            userId,
            eventType: "pack_opened",
            eventData: {
              setId,
              cardsReceived: selectedCards,
              packsRemaining: userPackCount - packsToUse + packsToBuy - (i + 1),
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
                // Ensure totalUniqueCards is always a number (0 is falsy but valid)
                totalUniqueCards: 0, // Will be calculated in future implementation
              },
            });
          }
        } catch (error) {
          console.error(
            "Error processing pack opening achievement events:",
            error
          );
          // Don't fail the pack opening process if achievement processing fails
        }

        // Create fate pick opportunity from this pack opening
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

        // Add this pack's cards to the result
        packs.push(selectedCards);
      }

      // Get updated user info
      const updatedUser = await UserModel.findById(userId);
      return {
        success: true,
        packs,
        remainingPacks: updatedUser?.pack_count ?? 0,
        remainingGems: updatedUser?.gems ?? 0,
      };
    } catch (error) {
      console.error("Error in openMultiplePacks:", error);
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Unknown error opening packs",
      };
    }
  },

  // Add this helper method to check if a set has cards
  async getSetCardCount(setId: string): Promise<number> {
    const db = require("../config/db.config").default;
    const query = `SELECT COUNT(*) as card_count FROM cards WHERE set_id = $1;`;
    const { rows } = await db.query(query, [setId]);
    return parseInt(rows[0]?.card_count || "0", 10);
  },
};

export default PackService;
