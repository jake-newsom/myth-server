import DailyShopModel from "../models/dailyShop.model";
import UserModel from "../models/user.model";
import CardModel from "../models/card.model";
import {
  DailyShopConfig,
  DailyShopOfferingWithCard,
  DailyShopPurchase,
  ShopItemType,
  CurrencyType,
} from "../types/database.types";
import { logger } from "../utils/logger";

interface ShopPurchaseRequest {
  offeringId: string;
  quantity?: number;
  useReset?: boolean;
}

interface ShopPurchaseResult {
  success: boolean;
  message: string;
  purchase?: DailyShopPurchase;
  newCurrencyBalance?: number;
  cardReceived?: any;
  packsReceived?: number;
}

interface UserShopData {
  shop_date: string;
  offerings: DailyShopOfferingWithCard[];
  userPurchases: DailyShopPurchase[];
  purchaseLimits: Record<ShopItemType, number>;
  resetCosts: Record<ShopItemType, number>;
  userCurrencies: {
    gems: number;
    card_fragments: number;
    fate_coins: number;
  };
}

const DailyShopService = {
  /**
   * Get current shop date in YYYY-MM-DD format (UTC)
   */
  getCurrentShopDate(): string {
    const now = new Date();
    // Ensure we're using UTC date, not local timezone
    const utcYear = now.getUTCFullYear();
    const utcMonth = String(now.getUTCMonth() + 1).padStart(2, "0");
    const utcDay = String(now.getUTCDate()).padStart(2, "0");
    return `${utcYear}-${utcMonth}-${utcDay}`;
  },

  /**
   * Get shop data personalized for a specific user
   */
  async getUserShopData(userId: string): Promise<UserShopData> {
    const shopDate = this.getCurrentShopDate();

    // Get current offerings
    const offerings = await DailyShopModel.getTodaysOfferings(shopDate);

    // Get user's purchases for today
    const userPurchases = await DailyShopModel.getUserPurchasesForDate(
      userId,
      shopDate
    );

    // Get shop configuration
    const configs = await DailyShopModel.getShopConfig();

    // Get user's current currencies
    const user = await UserModel.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Build purchase limits and reset costs
    const purchaseLimits: Record<ShopItemType, number> = {} as Record<
      ShopItemType,
      number
    >;
    const resetCosts: Record<ShopItemType, number> = {} as Record<
      ShopItemType,
      number
    >;

    configs.forEach((config) => {
      purchaseLimits[config.item_type] = config.daily_limit;
      resetCosts[config.item_type] = config.reset_price_gems;
    });

    return {
      shop_date: this.getCurrentShopDate(),
      offerings: offerings.map((offering) => ({
        ...offering,
        shop_date: this.getCurrentShopDate(), // Ensure consistent UTC date string
      })),
      userPurchases,
      purchaseLimits,
      resetCosts,
      userCurrencies: {
        gems: user.gems,
        card_fragments: user.card_fragments,
        fate_coins: user.fate_coins,
      },
    };
  },

  /**
   * Purchase an item from the daily shop
   */
  async purchaseItem(
    userId: string,
    request: ShopPurchaseRequest
  ): Promise<ShopPurchaseResult> {
    const shopDate = this.getCurrentShopDate();
    const quantity = request.quantity || 1;

    try {
      // Get the offering
      const offerings = await DailyShopModel.getTodaysOfferings(shopDate);
      const offering = offerings.find(
        (o) => o.offering_id === request.offeringId
      );

      if (!offering) {
        return {
          success: false,
          message: "Shop item not found or no longer available",
        };
      }

      // Get shop configuration for this item type
      const config = await DailyShopModel.getConfigByItemType(
        offering.item_type
      );
      if (!config) {
        return {
          success: false,
          message: "Shop configuration not found for this item type",
        };
      }

      // Get user's current purchases for this item type
      const userPurchases = await DailyShopModel.getUserPurchasesByItemType(
        userId,
        shopDate,
        offering.item_type
      );

      // Calculate current purchase count and resets used
      const currentPurchaseCount = userPurchases.reduce(
        (sum, p) => sum + p.quantity_purchased,
        0
      );
      const resetsUsed = userPurchases.reduce(
        (max, p) => Math.max(max, p.resets_used),
        0
      );

      // Check if user has reached purchase limit
      const effectiveLimit =
        config.daily_limit + resetsUsed * config.daily_limit;

      if (currentPurchaseCount + quantity > effectiveLimit) {
        if (request.useReset) {
          // User wants to use a reset
          const user = await UserModel.findById(userId);
          if (!user) {
            return { success: false, message: "User not found" };
          }

          if (user.gems < config.reset_price_gems) {
            return {
              success: false,
              message: `Insufficient gems for reset. Need ${config.reset_price_gems} gems.`,
            };
          }

          // Deduct gems for reset
          await UserModel.spendGems(userId, config.reset_price_gems);
        } else {
          return {
            success: false,
            message: `Daily purchase limit reached for ${offering.item_type}. Use gems to reset limit.`,
          };
        }
      }

      // Calculate total cost
      const totalCost = offering.price * quantity;

      // Check if user has enough currency
      const user = await UserModel.findById(userId);
      if (!user) {
        return { success: false, message: "User not found" };
      }

      const currentAmount = this.getUserCurrencyAmount(user, offering.currency);
      if (currentAmount < totalCost) {
        return {
          success: false,
          message: `Insufficient ${offering.currency}. You have ${currentAmount}, need ${totalCost}.`,
        };
      }

      // Process the purchase
      const newResetsUsed = request.useReset ? resetsUsed + 1 : resetsUsed;

      // Deduct currency
      await this.deductCurrency(userId, offering.currency, totalCost);

      // Create purchase record
      const purchase = await DailyShopModel.createPurchase({
        user_id: userId,
        offering_id: offering.offering_id,
        shop_date: shopDate,
        item_type: offering.item_type,
        quantity_purchased: quantity,
        total_cost: totalCost,
        currency_used: offering.currency,
        resets_used: newResetsUsed,
      });

      // Process the reward based on item type
      let cardReceived;
      let packsReceived;

      if (offering.item_type === "pack") {
        // Add packs to user
        await UserModel.addPacks(userId, quantity);
        packsReceived = quantity;
      } else if (offering.card_id) {
        // Add card to user's collection
        cardReceived = await CardModel.addCardToUser(userId, offering.card_id);
      }

      // Get updated currency balance
      const updatedUser = await UserModel.findById(userId);
      const newCurrencyBalance = updatedUser
        ? this.getUserCurrencyAmount(updatedUser, offering.currency)
        : 0;

      logger.info(`Daily shop purchase completed`, {
        userId,
        itemType: offering.item_type,
        quantity,
        totalCost,
        currency: offering.currency,
      });

      return {
        success: true,
        message: `Successfully purchased ${quantity} ${offering.item_type}(s)`,
        purchase,
        newCurrencyBalance,
        cardReceived,
        packsReceived,
      };
    } catch (error) {
      logger.error("Error processing daily shop purchase:", error as any);
      return {
        success: false,
        message: "Failed to process purchase",
      };
    }
  },

  /**
   * Generate daily shop offerings for a specific date
   */
  async generateDailyOfferings(shopDate?: string): Promise<void> {
    const targetDate = shopDate || this.getCurrentShopDate();

    try {
      logger.info(`Generating daily shop offerings for ${targetDate}`);

      // Clear existing offerings for the date
      await DailyShopModel.clearOfferingsForDate(targetDate);

      // Get shop configuration
      const configs = await DailyShopModel.getShopConfig();

      let slotNumber = 1;

      for (const config of configs) {
        if (!config.is_active) continue;

        if (
          config.item_type === "legendary_card" ||
          config.item_type === "epic_card"
        ) {
          // Generate mythology-based cards
          await this.generateMythologyCards(targetDate, config, slotNumber);
          slotNumber += 3; // 3 mythologies
        } else if (config.item_type === "enhanced_card") {
          // Generate random enhanced cards
          await this.generateEnhancedCards(targetDate, config, slotNumber);
          slotNumber += config.daily_availability;
        } else if (config.item_type === "pack") {
          // Generate pack offering
          await this.generatePackOffering(targetDate, config, slotNumber);
          slotNumber += 1;
        }
      }

      logger.info(
        `Successfully generated daily shop offerings for ${targetDate}`
      );
    } catch (error) {
      logger.error(
        `Error generating daily shop offerings for ${targetDate}:`,
        error as any
      );
      throw error;
    }
  },

  /**
   * Generate mythology-based card offerings (legendary/epic)
   */
  async generateMythologyCards(
    shopDate: string,
    config: DailyShopConfig,
    startingSlot: number
  ): Promise<void> {
    const mythologies = ["norse", "japanese", "polynesian"];
    const baseRarity =
      config.item_type === "legendary_card" ? "legendary" : "epic";

    for (let i = 0; i < mythologies.length; i++) {
      const mythology = mythologies[i];

      // Get current rotation state
      let rotation = await DailyShopModel.getRotationState(
        mythology,
        config.item_type
      );

      // Get available cards for this mythology and rarity
      const availableCards = await DailyShopModel.getCardsByMythologyAndRarity(
        mythology,
        baseRarity
      );

      if (availableCards.length === 0) {
        logger.warn(`No ${baseRarity} cards found for ${mythology} mythology`);
        continue;
      }

      // Calculate next card index (rotation)
      const currentIndex = rotation?.current_card_index || 0;
      // Ensure currentIndex is within bounds
      const safeCurrentIndex =
        currentIndex >= availableCards.length ? 0 : currentIndex;
      const nextIndex = (safeCurrentIndex + 1) % availableCards.length;
      const selectedCard = availableCards[safeCurrentIndex];

      if (!selectedCard) {
        logger.error(
          `No card found at index ${safeCurrentIndex} for ${mythology} ${baseRarity}`
        );
        continue;
      }

      // Update rotation state
      await DailyShopModel.updateRotationState(
        mythology,
        config.item_type,
        nextIndex
      );

      // Create offering
      await DailyShopModel.createOffering({
        shop_date: shopDate,
        item_type: config.item_type,
        card_id: selectedCard.card_id,
        mythology: mythology,
        price: config.price,
        currency: config.currency,
        slot_number: startingSlot + i,
      });

      logger.info(
        `Added ${mythology} ${baseRarity} card: ${selectedCard.name} to daily shop`
      );
    }
  },

  /**
   * Generate random enhanced card offerings
   */
  async generateEnhancedCards(
    shopDate: string,
    config: DailyShopConfig,
    startingSlot: number
  ): Promise<void> {
    const enhancedCards = await DailyShopModel.getEnhancedCards(
      config.daily_availability
    );

    for (let i = 0; i < enhancedCards.length; i++) {
      const card = enhancedCards[i];

      await DailyShopModel.createOffering({
        shop_date: shopDate,
        item_type: config.item_type,
        card_id: card.card_id,
        mythology: this.extractMythologyFromTags(card.tags),
        price: config.price,
        currency: config.currency,
        slot_number: startingSlot + i,
      });

      logger.info(
        `Added enhanced card: ${card.name} (${card.rarity}) to daily shop`
      );
    }
  },

  /**
   * Generate pack offering
   */
  async generatePackOffering(
    shopDate: string,
    config: DailyShopConfig,
    slotNumber: number
  ): Promise<void> {
    await DailyShopModel.createOffering({
      shop_date: shopDate,
      item_type: config.item_type,
      card_id: undefined,
      mythology: undefined,
      price: config.price,
      currency: config.currency,
      slot_number: slotNumber,
    });

    logger.info(
      `Added pack offering to daily shop: ${config.price} ${config.currency}`
    );
  },

  /**
   * Helper method to get user's currency amount
   */
  getUserCurrencyAmount(user: any, currency: CurrencyType): number {
    switch (currency) {
      case "gems":
        return user.gems;
      case "card_fragments":
        return user.card_fragments;
      case "fate_coins":
        return user.fate_coins;
      default:
        return 0;
    }
  },

  /**
   * Helper method to deduct currency from user
   */
  async deductCurrency(
    userId: string,
    currency: CurrencyType,
    amount: number
  ): Promise<void> {
    switch (currency) {
      case "gems":
        await UserModel.spendGems(userId, amount);
        break;
      case "card_fragments":
        await UserModel.spendCardFragments(userId, amount);
        break;
      case "fate_coins":
        await UserModel.updateFateCoins(userId, -amount);
        break;
    }
  },

  /**
   * Extract mythology from card tags
   */
  extractMythologyFromTags(tags: string[]): string | undefined {
    const mythologies = ["norse", "japanese", "polynesian"];
    return tags.find((tag) => mythologies.includes(tag.toLowerCase()));
  },

  /**
   * Admin method to refresh shop offerings
   */
  async refreshShopOfferings(shopDate?: string): Promise<void> {
    await this.generateDailyOfferings(shopDate);
  },

  /**
   * Get shop statistics for admin
   */
  async getShopStats(shopDate?: string): Promise<any> {
    const targetDate = shopDate || this.getCurrentShopDate();
    return await DailyShopModel.getPurchaseStats(targetDate);
  },
};

export default DailyShopService;
