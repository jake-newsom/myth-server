import DailyShopModel from "../models/dailyShop.model";
import UserModel from "../models/user.model";
import CardModel from "../models/card.model";
import db from "../config/db.config";
import {
  DailyShopConfig,
  DailyShopOfferingWithCard,
  DailyShopPurchase,
  ShopItemType,
  CurrencyType,
} from "../types/database.types";
import { logger } from "../utils/logger";
import { cacheInvalidation } from "./cache.invalidation.service";

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
      // Resolve offering and config before entering the transaction (read-only).
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

      const config = await DailyShopModel.getConfigByItemType(
        offering.item_type
      );
      if (!config) {
        return {
          success: false,
          message: "Shop configuration not found for this item type",
        };
      }

      const totalCost = offering.price * quantity;

      // All balance checks and mutations run inside one transaction with a
      // row-level lock so concurrent requests cannot double-spend or
      // double-grant.
      const client = await db.getClient();
      let purchase: DailyShopPurchase;
      let cardReceived: any;
      let packsReceived: number | undefined;
      let newCurrencyBalance: number;

      try {
        await client.query("BEGIN");

        // Lock user row and read current currency balances atomically.
        const { rows: userRows } = await client.query(
          `SELECT gems, card_fragments, fate_coins FROM users
           WHERE user_id = $1 FOR NO KEY UPDATE`,
          [userId]
        );
        if (userRows.length === 0) {
          await client.query("ROLLBACK");
          return { success: false, message: "User not found" };
        }
        const userRow = userRows[0];
        const currentAmount: number =
          offering.currency === "gems"
            ? userRow.gems
            : offering.currency === "card_fragments"
            ? userRow.card_fragments
            : userRow.fate_coins;

        // Re-check purchase count and resets inside the lock.
        const { rows: purchaseRows } = await client.query(
          `SELECT COALESCE(SUM(quantity_purchased), 0)::int AS total_purchased,
                  COALESCE(MAX(resets_used), 0)::int AS resets_used
           FROM daily_shop_purchases
           WHERE user_id = $1 AND shop_date = $2 AND item_type = $3`,
          [userId, shopDate, offering.item_type]
        );
        const currentPurchaseCount: number = purchaseRows[0].total_purchased;
        let resetsUsed: number = purchaseRows[0].resets_used;
        const effectiveLimit = config.daily_limit + resetsUsed * config.daily_limit;

        if (currentPurchaseCount + quantity > effectiveLimit) {
          if (request.useReset) {
            if (userRow.gems < config.reset_price_gems) {
              await client.query("ROLLBACK");
              return {
                success: false,
                message: `Insufficient gems for reset. Need ${config.reset_price_gems} gems.`,
              };
            }
            const { rows: resetRows } = await client.query(
              `UPDATE users SET gems = gems - $1 WHERE user_id = $2 AND gems >= $1 RETURNING gems`,
              [config.reset_price_gems, userId]
            );
            if (resetRows.length === 0) {
              await client.query("ROLLBACK");
              return { success: false, message: "Insufficient gems for reset." };
            }
            resetsUsed += 1;
          } else {
            await client.query("ROLLBACK");
            return {
              success: false,
              message: `Daily purchase limit reached for ${offering.item_type}. Use gems to reset limit.`,
            };
          }
        }

        if (currentAmount < totalCost) {
          await client.query("ROLLBACK");
          return {
            success: false,
            message: `Insufficient ${offering.currency}. You have ${currentAmount}, need ${totalCost}.`,
          };
        }

        // Deduct currency atomically.
        const currencyCol =
          offering.currency === "gems"
            ? "gems"
            : offering.currency === "card_fragments"
            ? "card_fragments"
            : "fate_coins";
        const { rows: deductRows } = await client.query(
          `UPDATE users SET ${currencyCol} = ${currencyCol} - $1
           WHERE user_id = $2 AND ${currencyCol} >= $1
           RETURNING ${currencyCol} AS new_balance`,
          [totalCost, userId]
        );
        if (deductRows.length === 0) {
          await client.query("ROLLBACK");
          return {
            success: false,
            message: `Insufficient ${offering.currency}.`,
          };
        }
        newCurrencyBalance = deductRows[0].new_balance;

        // Record the purchase inside the transaction.
        const { rows: purchaseInsertRows } = await client.query(
          `INSERT INTO daily_shop_purchases
             (user_id, offering_id, shop_date, item_type, quantity_purchased,
              total_cost, currency_used, resets_used)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING purchase_id, user_id, offering_id, shop_date, item_type,
                     quantity_purchased, total_cost, currency_used, resets_used, purchased_at`,
          [
            userId,
            offering.offering_id,
            shopDate,
            offering.item_type,
            quantity,
            totalCost,
            offering.currency,
            resetsUsed,
          ]
        );
        purchase = purchaseInsertRows[0];

        // Grant reward inside the transaction.
        if (offering.item_type === "pack") {
          await UserModel.addPacks(userId, quantity, client);
          packsReceived = quantity;
        } else if (offering.card_id) {
          cardReceived = await CardModel.addCardToUser(userId, offering.card_id, client);
        }

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }

      await cacheInvalidation.invalidateAfterShopPurchase(userId, offering.item_type);

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
      let offeringsCreated = 0;

      for (const config of configs) {
        if (!config.is_active) {
          logger.warn(
            `Skipping ${config.item_type} - configuration is inactive`
          );
          continue;
        }

        if (
          config.item_type === "legendary_card" ||
          config.item_type === "epic_card"
        ) {
          // Generate mythology-based cards
          const created = await this.generateMythologyCards(
            targetDate,
            config,
            slotNumber
          );
          offeringsCreated += created;
          slotNumber += 3; // 3 mythologies
        } else if (config.item_type === "enhanced_card") {
          // Generate random enhanced cards
          const created = await this.generateEnhancedCards(
            targetDate,
            config,
            slotNumber
          );
          offeringsCreated += created;
          slotNumber += config.daily_availability;
        } else if (config.item_type === "pack") {
          // Generate pack offering
          await this.generatePackOffering(targetDate, config, slotNumber);
          offeringsCreated += 1;
          slotNumber += 1;
        }
      }

      if (offeringsCreated === 0) {
        logger.error(
          `WARNING: No shop offerings were created for ${targetDate}! Check configurations and card availability.`
        );
      } else {
        logger.info(
          `Successfully generated ${offeringsCreated} daily shop offerings for ${targetDate}`
        );
      }
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
   * @returns Number of offerings created
   */
  async generateMythologyCards(
    shopDate: string,
    config: DailyShopConfig,
    startingSlot: number
  ): Promise<number> {
    const mythologies = ["norse", "japanese", "polynesian"];
    const baseRarity =
      config.item_type === "legendary_card" ? "legendary" : "epic";
    let offeringsCreated = 0;

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
        logger.error(
          `CRITICAL: No ${baseRarity} cards found for ${mythology} mythology - cannot create shop offering!`
        );
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

      offeringsCreated++;
      logger.info(
        `Added ${mythology} ${baseRarity} card: ${selectedCard.name} to daily shop`
      );
    }

    return offeringsCreated;
  },

  /**
   * Generate random enhanced card offerings
   * @returns Number of offerings created
   */
  async generateEnhancedCards(
    shopDate: string,
    config: DailyShopConfig,
    startingSlot: number
  ): Promise<number> {
    const enhancedCards = await DailyShopModel.getEnhancedCards(
      config.daily_availability
    );

    if (enhancedCards.length === 0) {
      logger.warn(
        `No enhanced cards found in database - cannot create enhanced card offerings`
      );
      return 0;
    }

    for (let i = 0; i < enhancedCards.length; i++) {
      const card = enhancedCards[i];

      await DailyShopModel.createOffering({
        shop_date: shopDate,
        item_type: config.item_type,
        card_id: card.card_id,
        mythology: this.extractMythologyFromSetName(card.set_name),
        price: config.price,
        currency: config.currency,
        slot_number: startingSlot + i,
      });

      logger.info(
        `Added enhanced card: ${card.name} (${card.rarity}) to daily shop`
      );
    }

    return enhancedCards.length;
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
   * Extract mythology from card set name
   */
  extractMythologyFromSetName(setName: string): string | undefined {
    if (!setName) return undefined;
    const lowerSetName = setName.toLowerCase();
    const mythologies = ["norse", "japanese", "polynesian"];
    return mythologies.find((m) => lowerSetName.includes(m));
  },

  /**
   * Extract mythology from card tags (legacy - kept for backwards compatibility)
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
