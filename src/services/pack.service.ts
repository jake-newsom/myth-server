import SetModel from "../models/set.model";
import UserModel from "../models/user.model";
import CardModel from "../models/card.model";
import { Card } from "../types/database.types";
import { RarityUtils } from "../types/card.types";
import logger from "../utils/logger";
import DailyTaskService from "./dailyTask.service";
import { cacheInvalidation } from "./cache.invalidation.service";
import { USER_LIMITS } from "../config/constants";

const CARDS_PER_PACK = 5;
const GOD_PACK_CHANCE = 1 / 1200; // 1 in 1500 chance

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
  isGodPack?: boolean;
}

const PackService = {
  /**
   * Core function to open a single pack - shared logic for openPack and openMultiplePacks
   * Does NOT consume packs or gems - that should be done by the caller
   * Returns the selected cards and whether it was a god pack
   */
  async _openSinglePackCore(
    userId: string,
    setId: string,
    setCards: CardWithAbility[]
  ): Promise<{
    selectedCards: CardWithAbility[];
    isGodPack: boolean;
    packOpeningId: string;
  }> {
    // Check for God Pack and select cards accordingly
    const isGodPack = this.isGodPack();
    const selectedCards = isGodPack
      ? this.selectGodPackCards(setCards, CARDS_PER_PACK)
      : this.selectRandomCards(setCards, CARDS_PER_PACK);

    if (isGodPack) {
      logger.info("God Pack opened!", { userId, setId });
    }

    // Add the selected cards to user's collection
    await this.addCardsToUserCollection(userId, selectedCards);

    // Log the pack opening to history
    await this.logPackOpening(userId, setId, selectedCards);

    // Get the pack opening ID from the history
    const packOpeningQuery = `
      SELECT pack_opening_id FROM pack_opening_history 
      WHERE user_id = $1 
      ORDER BY opened_at DESC 
      LIMIT 1;
    `;
    const db = require("../config/db.config").default;
    const { rows: packRows } = await db.query(packOpeningQuery, [userId]);
    const packOpeningId = packRows[0]?.pack_opening_id || "";

    // Create fate pick opportunity from this pack opening
    try {
      const FatePickService = await import("./fatePick.service");

      if (packOpeningId) {
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
      logger.error(
        "Error creating fate pick from pack opening",
        {},
        error instanceof Error ? error : new Error(String(error))
      );
      // Don't fail the pack opening process if fate pick creation fails
    }

    return { selectedCards, isGodPack, packOpeningId };
  },

  /**
   * Count cards by base rarity from a list of cards
   */
  _countCardsByRarity(cards: CardWithAbility[]): Record<string, number> {
    const rarityCounts: Record<string, number> = {
      common: 0,
      rare: 0,
      epic: 0,
      legendary: 0,
    };

    for (const card of cards) {
      const baseRarity = RarityUtils.getBaseRarity(card.rarity as any);
      if (rarityCounts[baseRarity] !== undefined) {
        rarityCounts[baseRarity]++;
      }
    }

    return rarityCounts;
  },

  /**
   * Trigger achievement events for cards collected
   */
  async _triggerCardCollectionAchievements(
    userId: string,
    rarityCounts: Record<string, number>
  ): Promise<void> {
    try {
      const AchievementService = await import("./achievement.service");
      const CardModel = await import("../models/card.model");

      // Get updated card counts after adding cards to collection
      const totalUniqueCards = await CardModel.default.getUserUniqueCardCount(
        userId
      );
      const totalMythicCards = await CardModel.default.getUserMythicCardCount(
        userId
      );
      const uniqueCardsByRarity =
        await CardModel.default.getUserUniqueCardCountByRarity(userId);

      // Trigger card collection event once per rarity with the count
      for (const [rarity, count] of Object.entries(rarityCounts)) {
        if (count > 0) {
          // Trigger ONCE per rarity with the count, not once per card
          await AchievementService.default.triggerAchievementEvent({
            userId,
            eventType: "card_collected",
            eventData: {
              rarity,
              count, // Pass the count so the handler can increment properly
              totalUniqueCards,
              totalMythicCards,
              uniqueCardsByRarity,
            },
          });
        }
      }
    } catch (error) {
      logger.error(
        "Error processing card collection achievement events",
        {},
        error instanceof Error ? error : new Error(String(error))
      );
      // Don't fail the pack opening process if achievement processing fails
    }
  },

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

    // 5. Remove one pack from user's total pack count
    const updatedUser = await UserModel.removePacks(userId, 1);
    if (!updatedUser) {
      throw new Error("Failed to remove pack from user inventory");
    }

    // 6. Open the pack using core function
    const { selectedCards, isGodPack } = await this._openSinglePackCore(
      userId,
      setId,
      setCards
    );

    // 7. Invalidate user's card cache since collection changed
    await cacheInvalidation.invalidateAfterPackOpen(userId);

    // 8. Trigger achievement events for pack opening and card collection
    try {
      const AchievementService = await import("./achievement.service");

      // Pack opened event
      await AchievementService.default.triggerAchievementEvent({
        userId,
        eventType: "pack_opened",
        eventData: {
          setId,
          packsOpened: 1,
          packsRemaining: updatedUser.pack_count,
        },
      });

      // Count cards by rarity and trigger collection achievements
      const rarityCounts = this._countCardsByRarity(selectedCards);
      await this._triggerCardCollectionAchievements(userId, rarityCounts);
    } catch (error) {
      logger.error(
        "Error processing achievement events",
        {},
        error instanceof Error ? error : new Error(String(error))
      );
      // Don't fail the pack opening process if achievement processing fails
    }

    return {
      cards: selectedCards,
      remainingPacks: updatedUser.pack_count,
      isGodPack,
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
        sa.trigger_moments as sa_trigger_moments, sa.parameters as sa_parameters
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
            triggerMoments: row.sa_trigger_moments || [],
            parameters: row.sa_parameters,
          }
        : null,
    }));
  },

  isGodPack(): boolean {
    return Math.random() < GOD_PACK_CHANCE;
  },

  selectGodPackCards(
    cards: CardWithAbility[],
    count: number
  ): CardWithAbility[] {
    // God Pack rarity distribution: 50% legendary, 20% epic, 15% rare, 15% common
    // All cards must be variant (+/++/+++)
    const godPackRarities = ["legendary", "epic", "rare", "common"];
    const godPackWeights = [50, 20, 15, 15]; // Percentages
    const variantTypes = ["+", "++", "+++"];

    // Group cards by base rarity
    const cardsByRarity: { [key: string]: CardWithAbility[] } = {};
    cards.forEach((card) => {
      const baseRarity = RarityUtils.getBaseRarity(card.rarity as any);
      if (!cardsByRarity[baseRarity]) {
        cardsByRarity[baseRarity] = [];
      }
      cardsByRarity[baseRarity].push(card);
    });

    const selectedCards: CardWithAbility[] = [];

    for (let i = 0; i < count; i++) {
      // Select base rarity based on God Pack weights
      const random = Math.random() * 100;
      let selectedBaseRarity = "common";
      let cumulativeWeight = 0;

      for (let j = 0; j < godPackRarities.length; j++) {
        cumulativeWeight += godPackWeights[j];
        if (random <= cumulativeWeight) {
          selectedBaseRarity = godPackRarities[j];
          break;
        }
      }

      // Randomly select a variant type (+, ++, or +++)
      const variantType =
        variantTypes[Math.floor(Math.random() * variantTypes.length)];
      const targetRarity = `${selectedBaseRarity}${variantType}`;

      // Try to find cards of the target variant rarity first
      let availableCards = cardsByRarity[targetRarity];
      let actualRarity = targetRarity;

      // If no variant cards exist, fall back to base rarity cards but still assign variant
      if (!availableCards || availableCards.length === 0) {
        availableCards = cardsByRarity[selectedBaseRarity];
        // We'll still assign the variant rarity even if the card doesn't exist in that variant
      }

      // Final fallback to any available cards
      if (!availableCards || availableCards.length === 0) {
        availableCards = cards;
      }

      if (availableCards.length > 0) {
        const randomIndex = Math.floor(Math.random() * availableCards.length);
        const selectedCard = { ...availableCards[randomIndex] };

        // Force the variant rarity for God Pack
        selectedCard.rarity = targetRarity as any;
        selectedCards.push(selectedCard);
      }
    }

    logger.info("God Pack cards selected", {
      cardRarities: selectedCards.map((card) => ({
        name: card.name,
        rarity: card.rarity,
      })),
    });

    return selectedCards;
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

    // Log rarity distribution for debugging
    logger.debug("Cards by rarity in set", {
      rarityDistribution: Object.fromEntries(
        Object.entries(cardsByRarity).map(([rarity, cards]) => [
          rarity,
          cards.length,
        ])
      ),
    });

    const selectedCards: CardWithAbility[] = [];

    let variantCount = 0;
    for (let i = 0; i < count; i++) {
      const selectedRarity = this.selectWeightedRarity();
      const isVariantRarity = selectedRarity.includes("+");

      let availableCards = cardsByRarity[selectedRarity];
      let actualRarity = selectedRarity;

      if (!availableCards || availableCards.length === 0) {
        const baseRarity = RarityUtils.getBaseRarity(selectedRarity as any);
        availableCards = cardsByRarity[baseRarity];
        actualRarity = baseRarity;
      }

      // Final fallback to any available cards
      if (!availableCards || availableCards.length === 0) {
        availableCards = cards;
        actualRarity = selectedRarity;
      }

      if (availableCards.length > 0) {
        const randomIndex = Math.floor(Math.random() * availableCards.length);
        const selectedCard = { ...availableCards[randomIndex] };

        // Only count as variant if we selected a variant rarity AND found matching cards
        const isVariantRarity = selectedRarity.includes("+");
        if (
          cardsByRarity[selectedRarity] &&
          cardsByRarity[selectedRarity].length > 0
        ) {
          selectedCard.rarity = selectedRarity as any;
          if (isVariantRarity) {
            variantCount++;
          }
        }
        selectedCards.push(selectedCard);
      }
    }

    // console.log(`Pack complete: ${variantCount}/${count} variant cards`);
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

  getPackRarityWeights(): { [key: string]: number } {
    // Define rarity weights for pack opening
    // Higher numbers = more likely to appear
    return {
      common: 55,
      rare: 20,
      epic: 15,
      legendary: 6.5,
      "+": 2.3,
      "++": 0.8,
      "+++": 0.4,
    };
  },

  selectWeightedRarity(): string {
    const weights = this.getPackRarityWeights();

    const totalWeight = Object.values(weights).reduce(
      (sum, weight) => sum + weight,
      0
    );
    let random = Math.random() * totalWeight;

    let selectedRarity = "common"; // fallback
    for (const [rarity, weight] of Object.entries(weights)) {
      random -= weight;
      if (random <= 0) {
        selectedRarity = rarity;
        break;
      }
    }

    if (selectedRarity.includes("+")) {
      const br = Math.random() * 100;
      if (br < 15) {
        selectedRarity = `legendary${selectedRarity}`;
      } else if (br < 35) {
        selectedRarity = `epic${selectedRarity}`;
      } else if (br < 65) {
        selectedRarity = `rare${selectedRarity}`;
      } else {
        selectedRarity = `common${selectedRarity}`;
      }
    }

    return selectedRarity;
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

    // 4. CRITICAL: Check if opening these packs would exceed card limit BEFORE consuming resources
    const currentCardCount = await CardModel.getUserTotalCardCount(userId);
    const cardsToReceive = count * CARDS_PER_PACK;
    if (currentCardCount + cardsToReceive > USER_LIMITS.MAX_CARDS) {
      return {
        success: false,
        message: `Opening ${count} pack(s) would exceed your card limit of ${USER_LIMITS.MAX_CARDS}. You currently have ${currentCardCount} cards and would receive ${cardsToReceive} more cards.`,
        code: "MAX_CARDS_EXCEEDED",
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
    const godPacks: number[] = []; // Track which pack numbers are God Packs
    const totalRarityCounts: Record<string, number> = {
      common: 0,
      rare: 0,
      epic: 0,
      legendary: 0,
    };

    try {
      // Get all cards from this set
      const setCards = await this.getCardsFromSet(setId);
      if (setCards.length === 0) {
        throw new Error("No cards available in this set");
      }

      // Process each pack
      for (let i = 0; i < count; i++) {
        // Open pack using core function
        const { selectedCards, isGodPack } = await this._openSinglePackCore(
          userId,
          setId,
          setCards
        );

        if (isGodPack) {
          logger.info("God Pack opened in multiple pack opening!", {
            userId,
            setId,
            packNumber: i + 1,
          });
          godPacks.push(i); // Track this pack as a God Pack (0-indexed)
        }

        // Count cards by rarity for this pack
        const packRarityCounts = this._countCardsByRarity(selectedCards);
        for (const [rarity, count] of Object.entries(packRarityCounts)) {
          totalRarityCounts[rarity] = (totalRarityCounts[rarity] || 0) + count;
        }

        // Add this pack's cards to the result
        packs.push(selectedCards);
      }

      // Invalidate user's card cache since collection changed
      await cacheInvalidation.invalidateAfterPackOpen(userId);

      // Trigger all achievements at once after opening all packs (batched)
      try {
        const AchievementService = await import("./achievement.service");

        // Pack opened achievement - trigger once with total count
        await AchievementService.default.triggerAchievementEvent({
          userId,
          eventType: "pack_opened",
          eventData: {
            setId,
            packsOpened: count,
            packsRemaining: userPackCount - packsToUse + packsToBuy - count,
          },
        });

        // Card collection achievements - trigger once per rarity with accumulated counts
        await this._triggerCardCollectionAchievements(
          userId,
          totalRarityCounts
        );
      } catch (error) {
        logger.error(
          "Error processing achievement events",
          {},
          error instanceof Error ? error : new Error(String(error))
        );
        // Don't fail the pack opening process if achievement processing fails
      }

      // Track daily task progress for pack openings
      try {
        await DailyTaskService.trackPackOpen(userId, count);
      } catch (error) {
        logger.error(
          "Error tracking pack opening for daily task",
          {},
          error instanceof Error ? error : new Error(String(error))
        );
        // Don't fail the pack opening process if tracking fails
      }

      // Get updated user info
      const updatedUser = await UserModel.findById(userId);
      return {
        success: true,
        packs,
        remainingPacks: updatedUser?.pack_count ?? 0,
        remainingGems: updatedUser?.gems ?? 0,
        godPacks, // Include which packs were God Packs
      };
    } catch (error) {
      logger.error(
        "Error in openMultiplePacks",
        {},
        error instanceof Error ? error : new Error(String(error))
      );
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
