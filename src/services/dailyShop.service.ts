import DailyShopModel from "../models/dailyShop.model";
import UserModel from "../models/user.model";
import CardModel from "../models/card.model";
import db from "../config/db.config";
import {
  DailyShopConfig,
  DailyShopOfferingWithCard,
  DailyShopPurchase,
  ShopItemType,
  ShopTab,
  CurrencyType,
} from "../types/database.types";
import { logger } from "../utils/logger";
import EmberService from "./ember.service";
import FeatureFlagService from "./featureFlag.service";
import {
  EMBER_CONFIG,
  SHOP_CONFIG,
  SHOP_MYTHOLOGIES,
} from "../config/constants";
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
  /** Embers granted by an ember_bundle purchase. Additive. */
  embersReceived?: number;
  /** Card fragments granted by a fragment_bundle purchase. Additive. */
  fragmentsReceived?: number;
  /** Fate coins granted by a fate_coin_bundle purchase. Additive. */
  fateCoinsReceived?: number;
}

/**
 * A tab's reset state as the client needs it: how many resets have been bought
 * this period, what the next one costs, and when the counter clears.
 */
interface TabResetState {
  shop_tab: string;
  resets_used: number;
  next_reset_cost: number;
  resets_at: string;
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
  /** Additive: absent on the flag-off path, ignored by shipped clients. */
  resetState?: Record<string, TabResetState>;
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
   * ISO week key (YYYY-Www) for the current UTC instant.
   *
   * Used as the reset period for weekly tabs (the saga shop). Computed rather
   * than stored so the "counter clears at the server reset" rule needs no job:
   * a new week is simply a key with no row behind it yet.
   */
  getCurrentWeekKey(date: Date = new Date()): string {
    // ISO week: Thursday of the current week decides the year.
    const d = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
    );
    const dayNum = d.getUTCDay() || 7; // Monday = 1 … Sunday = 7
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil(
      ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
    );
    return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  },

  /** The reset period each tab is keyed by. */
  getPeriodKeys(): Record<string, string> {
    return {
      daily: this.getCurrentShopDate(),
      soul: this.getCurrentShopDate(),
      saga: this.getCurrentWeekKey(),
    };
  },

  /** When a tab's current period ends, as an ISO timestamp. */
  getTabResetsAt(tab: string): string {
    const now = new Date();
    if (tab === "saga") {
      // Next Monday 00:00 UTC.
      const daysUntilMonday = (8 - (now.getUTCDay() || 7)) % 7 || 7;
      const next = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate() + daysUntilMonday
        )
      );
      return next.toISOString();
    }
    // Next 00:00 UTC.
    const next = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
    );
    return next.toISOString();
  },

  /**
   * Price of a player's next paid reset on a tab: 50, 100, 200, 400 …
   *
   * Doubling rather than a flat fee so the reroll cannot be spammed into a
   * de-facto "buy any card": the fourth reset in a day already costs 400 gems.
   */
  getResetCost(resetsUsed: number): number {
    return SHOP_CONFIG.RESET_BASE_GEMS * Math.pow(2, resetsUsed);
  },

  /** Whether the overhauled shop is on for this player. */
  async isOverhaulEnabled(userId: string | null | undefined): Promise<boolean> {
    return FeatureFlagService.isEnabled(userId, SHOP_CONFIG.FLAG);
  },

  /**
   * Get shop data personalized for a specific user.
   *
   * `tabs` defaults to `["daily"]` so the legacy response is unchanged: shipped
   * clients render `offerings[]` as one flat list and must never be handed the
   * Soul Shop's hundreds of rows.
   */
  async getUserShopData(
    userId: string,
    tabs: ShopTab[] = ["daily"]
  ): Promise<UserShopData> {
    const shopDate = this.getCurrentShopDate();

    // Get current offerings
    const offerings = await DailyShopModel.getTodaysOfferings(shopDate, tabs);

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

    // Additive field: only computed when the overhaul is on for this player,
    // and ignored outright by shipped clients.
    let resetState: Record<string, TabResetState> | undefined;
    if (await this.isOverhaulEnabled(userId)) {
      const periodKeys = this.getPeriodKeys();
      const existing = await DailyShopModel.getTabResets(userId, periodKeys);
      resetState = {};
      for (const tab of Object.keys(periodKeys)) {
        const used = existing[tab]?.resets_used ?? 0;
        resetState[tab] = {
          shop_tab: tab,
          resets_used: used,
          next_reset_cost: this.getResetCost(used),
          resets_at: this.getTabResetsAt(tab),
        };
      }
    }

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
      resetState,
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
      // Both tabs are searched: a purchase names an offering id, and the id
      // alone does not say which tab it came from.
      const offerings = await DailyShopModel.getTodaysOfferings(shopDate, [
        "daily",
        "soul",
      ]);
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
      let embersReceived: number | undefined;
      let fragmentsReceived: number | undefined;
      let fateCoinsReceived: number | undefined;
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
        //
        // Soul Shop cards are counted PER OFFERING, not per item_type: the
        // catalogue lists every common and rare at once, and a shared
        // `soul_card` counter would mean buying one card locked out all the
        // others. Every other item type has a single slot, so the two scopes
        // agree for them.
        const isPerOffering = offering.item_type === "soul_card";
        const { rows: purchaseRows } = await client.query(
          isPerOffering
            ? `SELECT COALESCE(SUM(quantity_purchased), 0)::int AS total_purchased,
                      COALESCE(MAX(resets_used), 0)::int AS resets_used
               FROM daily_shop_purchases
               WHERE user_id = $1 AND shop_date = $2 AND offering_id = $3`
            : `SELECT COALESCE(SUM(quantity_purchased), 0)::int AS total_purchased,
                      COALESCE(MAX(resets_used), 0)::int AS resets_used
               FROM daily_shop_purchases
               WHERE user_id = $1 AND shop_date = $2 AND item_type = $3`,
          [userId, shopDate, isPerOffering ? offering.offering_id : offering.item_type]
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
        } else if (offering.item_type === "ember_bundle") {
          // Uncapped on purpose: buying is one of the two paths allowed to
          // push a balance past the regeneration cap.
          embersReceived = EMBER_CONFIG.SHOP_BUNDLE_AMOUNT * quantity;
          await EmberService.grant(userId, embersReceived, client);
        } else if (offering.item_type === "fragment_bundle") {
          fragmentsReceived = SHOP_CONFIG.FRAGMENT_BUNDLE_AMOUNT * quantity;
          await client.query(
            `UPDATE users SET card_fragments = card_fragments + $1 WHERE user_id = $2`,
            [fragmentsReceived, userId]
          );
        } else if (offering.item_type === "fate_coin_bundle") {
          fateCoinsReceived = SHOP_CONFIG.FATE_COIN_BUNDLE_AMOUNT * quantity;
          await client.query(
            `UPDATE users SET fate_coins = fate_coins + $1 WHERE user_id = $2`,
            [fateCoinsReceived, userId]
          );
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
        embersReceived,
        fragmentsReceived,
        fateCoinsReceived,
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

      // Generation has no user to evaluate against, so the overhaul is driven
      // by the flag's GLOBAL state here. Off => the exact pre-overhaul path.
      const overhaul = await FeatureFlagService.isEnabledGlobally(
        SHOP_CONFIG.FLAG
      );

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

        // soul_card offerings are not slot-generated; the whole catalogue is
        // written in one pass below.
        if (config.item_type === "soul_card") {
          continue;
        }

        if (
          config.item_type === "legendary_card" ||
          config.item_type === "epic_card" ||
          config.item_type === "rare_card"
        ) {
          // Generate mythology-based cards
          const created = overhaul
            ? await this.generateRotatedMythologyCards(
                targetDate,
                config,
                slotNumber
              )
            : await this.generateMythologyCards(
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
        } else if (
          config.item_type === "ember_bundle" ||
          config.item_type === "fragment_bundle" ||
          config.item_type === "fate_coin_bundle"
        ) {
          // Currency bundles: fixed-price offers with no card behind them, so
          // they use the same cardless offering shape as packs. One slot each;
          // the repeatability comes from the config's daily_limit, not from
          // listing them many times.
          await this.generateFlatOffering(targetDate, config, slotNumber);
          offeringsCreated += 1;
          slotNumber += 1;
        }
      }

      if (overhaul) {
        offeringsCreated += await this.generateSoulShop(targetDate);
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
   * Days elapsed since the Unix epoch, in UTC. The rotation's cursor.
   */
  daysSinceEpoch(shopDate: string): number {
    return Math.floor(Date.parse(`${shopDate}T00:00:00Z`) / 86400000);
  },

  /**
   * Deterministic set rotation for legendary/epic cards.
   *
   * Replaces the stored-index rotation (`daily_shop_rotations`) with a pure
   * function of the date. Three properties matter, and the stored index had
   * none of them reliably:
   *
   *  - **Full coverage.** The index walks `pool[(days + offset) % pool.length]`,
   *    so every legendary and every epic of every mythology is offered at least
   *    once every `pool.length` days. That is what makes a card behind a
   *    collection achievement obtainable without gacha luck — the requirement
   *    for the Japan release.
   *  - **Determinism.** The same date yields the same shop. Regenerating a day
   *    (a redeploy, an admin refresh, the backfill path) cannot reroll the cards
   *    a player is looking at.
   *  - **Growth safety.** Adding a card shifts where the cycle sits but never
   *    removes a card from it.
   *
   * The per-mythology `offset` staggers the three so they do not all advance to
   * the same index on the same day, which would make the shop feel repetitive.
   *
   * Pool order is `card_variant_id` (see the model), not name — a name-ordered
   * pool reshuffles every time a character is renamed, which silently skips
   * whichever card the index had already passed.
   *
   * @returns Number of offerings created
   */
  /**
   * Base rarity offered by each rotated card slot. A map rather than a ternary:
   * the previous `item_type === "legendary_card" ? "legendary" : "epic"` fell
   * through to "epic" for every other type, so adding a third slot silently
   * offered epics under the new label.
   */
  rotatedBaseRarity(itemType: ShopItemType): string | null {
    switch (itemType) {
      case "legendary_card":
        return "legendary";
      case "epic_card":
        return "epic";
      case "rare_card":
        return "rare";
      default:
        return null;
    }
  },

  async generateRotatedMythologyCards(
    shopDate: string,
    config: DailyShopConfig,
    startingSlot: number
  ): Promise<number> {
    const baseRarity = this.rotatedBaseRarity(config.item_type);
    if (!baseRarity) {
      logger.error(
        `No base rarity mapped for rotated slot ${config.item_type} - skipping`
      );
      return 0;
    }
    const cursor = this.daysSinceEpoch(shopDate);
    let offeringsCreated = 0;

    for (let i = 0; i < SHOP_MYTHOLOGIES.length; i++) {
      const mythology = SHOP_MYTHOLOGIES[i];

      const pool = await DailyShopModel.getCardsByMythologyAndRarity(
        mythology,
        baseRarity
      );

      if (pool.length === 0) {
        logger.error(
          `CRITICAL: No ${baseRarity} cards found for ${mythology} mythology - cannot create shop offering!`
        );
        continue;
      }

      const selectedCard = pool[(cursor + i) % pool.length];

      await DailyShopModel.createOffering({
        shop_date: shopDate,
        item_type: config.item_type,
        card_id: selectedCard.card_id,
        mythology,
        price: config.price,
        currency: config.currency,
        slot_number: startingSlot + i,
        shop_tab: "daily",
      });

      offeringsCreated++;
      logger.info(
        `Rotation offered ${mythology} ${baseRarity}: ${selectedCard.name} (index ${
          (cursor + i) % pool.length
        }/${pool.length})`
      );
    }

    return offeringsCreated;
  },

  /**
   * Build the Soul Shop: every released common at 10 fragments and every
   * released rare at 50.
   *
   * Exhaustive rather than rotating, on purpose. The legendary/epic rotation
   * guarantees coverage over a cycle of days; the common/rare pool is far
   * larger, so a rotation there would take months to come around. Listing the
   * whole pool every day means any card a collection achievement needs is
   * purchasable the moment the player has the fragments — which is the other
   * half of the Japan guarantee.
   *
   * Written as one bulk insert: this is hundreds of rows and runs on the
   * midnight rotation path.
   *
   * @returns Number of offerings created
   */
  async generateSoulShop(shopDate: string): Promise<number> {
    const config = await DailyShopModel.getConfigByItemType("soul_card");
    if (!config) {
      logger.warn("No soul_card config found - skipping Soul Shop generation");
      return 0;
    }

    const rows: any[] = [];
    let slot = 1;

    for (const [baseRarity, price] of Object.entries(
      SHOP_CONFIG.SOUL_SHOP_PRICES
    )) {
      const pool = await DailyShopModel.getCardsByBaseRarity(baseRarity);
      for (const card of pool) {
        rows.push({
          shop_date: shopDate,
          item_type: "soul_card" as ShopItemType,
          card_id: card.card_id,
          mythology: this.extractMythologyFromSetName(card.set_name),
          price,
          currency: config.currency,
          slot_number: slot++,
          shop_tab: "soul" as ShopTab,
        });
      }
    }

    await DailyShopModel.createOfferingsBulk(rows);
    logger.info(`Generated ${rows.length} Soul Shop offerings for ${shopDate}`);
    return rows.length;
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
    const baseRarity = this.rotatedBaseRarity(config.item_type);
    if (!baseRarity) {
      logger.error(
        `No base rarity mapped for rotated slot ${config.item_type} - skipping`
      );
      return 0;
    }
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
    return this.generateFlatOffering(shopDate, config, slotNumber);
  },

  /**
   * Generate a cardless, fixed-price offering (packs, ember bundles).
   *
   * These have no card to pick and no mythology to rotate, so the offering is
   * just the config's price and currency in a slot.
   */
  async generateFlatOffering(
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
      shop_tab: "daily",
    });

    logger.info(
      `Added ${config.item_type} offering to daily shop: ${config.price} ${config.currency}`
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
   * Add offerings for any active item type that today is missing.
   *
   * `generateDailyOfferings` clears the whole day and rebuilds it, which is
   * correct at the midnight rotation but destructive mid-day: it would reroll
   * the cards players are looking at and orphan the offering ids their
   * purchases reference. So when a NEW item type is introduced — the ember
   * bundle is the first — today's shop has no row for it and would not get one
   * until the next rotation.
   *
   * This fills only the gaps. Item types already present are left untouched,
   * so existing offerings, their slots, and purchase history all survive.
   *
   * Idempotent: a second call finds nothing missing and does nothing.
   *
   * @returns the item types that were added
   */
  async backfillMissingOfferings(shopDate?: string): Promise<ShopItemType[]> {
    const targetDate = shopDate || this.getCurrentShopDate();

    const [configs, existing] = await Promise.all([
      DailyShopModel.getShopConfig(),
      DailyShopModel.getTodaysOfferings(targetDate),
    ]);

    // Nothing to backfill into an empty day — that is the rotation's job, and
    // rebuilding the whole day is the right behaviour there.
    if (existing.length === 0) {
      return [];
    }

    const presentTypes = new Set(existing.map((o) => o.item_type));
    // Continue after the highest slot in use so a backfilled item never
    // collides with an existing one.
    let slotNumber =
      existing.reduce((max, o) => Math.max(max, o.slot_number), 0) + 1;

    const added: ShopItemType[] = [];

    const overhaul = await FeatureFlagService.isEnabledGlobally(
      SHOP_CONFIG.FLAG
    );

    for (const config of configs) {
      if (!config.is_active || presentTypes.has(config.item_type)) {
        continue;
      }

      // The Soul Shop is not slot-based; it is filled in one pass below.
      if (config.item_type === "soul_card") {
        continue;
      }

      try {
        if (
          config.item_type === "legendary_card" ||
          config.item_type === "epic_card" ||
          config.item_type === "rare_card"
        ) {
          const created = overhaul
            ? await this.generateRotatedMythologyCards(
                targetDate,
                config,
                slotNumber
              )
            : await this.generateMythologyCards(
                targetDate,
                config,
                slotNumber
              );
          slotNumber += 3; // 3 mythologies
          if (created === 0) continue;
        } else if (config.item_type === "enhanced_card") {
          const created = await this.generateEnhancedCards(
            targetDate,
            config,
            slotNumber
          );
          slotNumber += config.daily_availability;
          if (created === 0) continue;
        } else {
          // Cardless, fixed-price items: packs and the currency bundles.
          await this.generateFlatOffering(targetDate, config, slotNumber);
          slotNumber += 1;
        }

        added.push(config.item_type);
      } catch (error) {
        // One item type failing must not block the others.
        logger.error(
          `Failed to backfill ${config.item_type} offering for ${targetDate}:`,
          error as any
        );
      }
    }

    // The Soul Shop is all-or-nothing for a date: if the overhaul turned on
    // mid-day, today has no soul rows at all and the tab would read as empty
    // until the next rotation. Fill it once, and never touch it if it exists —
    // rebuilding it would orphan the offering ids players have purchased
    // against today.
    if (overhaul) {
      const existingSoul = await DailyShopModel.getTodaysOfferings(targetDate, [
        "soul",
      ]);
      if (existingSoul.length === 0) {
        const created = await this.generateSoulShop(targetDate);
        if (created > 0) added.push("soul_card");
      }
    }

    if (added.length > 0) {
      logger.info(
        `Backfilled ${added.length} missing shop offering type(s) for ${targetDate}: ${added.join(", ")}`
      );
    }

    return added;
  },

  /**
   * Pay gems to reroll a shop tab for the rest of the period.
   *
   * What "reroll" means differs by tab, and deliberately so:
   *
   *  - **daily** — regenerate the rotated card slots one cycle-step further on,
   *    and clear the player's purchase records for that tab so the refreshed
   *    slots are buyable again. The rotation is global (every player sees the
   *    same day), so a paid reset advances only what THIS player has bought
   *    against, not the shared offerings — otherwise one player's reroll would
   *    change every other player's shop.
   *  - **soul** — the catalogue is exhaustive and never changes, so there is
   *    nothing to reroll. A reset there only clears this player's per-card
   *    daily purchase limits, which is the thing they would actually be paying
   *    for.
   *  - **saga** — the saga shop is owned by the season, so the reset only
   *    clears the local purchase caps; season stock is untouched.
   *
   * Price doubles per reset within the period (50, 100, 200, 400 …) and the
   * counter clears at the tab's own reset, which falls out of `period_key`.
   *
   * The gem debit, the counter increment and the purchase clear all happen in
   * one transaction under a row lock, so two taps cannot both charge 50.
   */
  async resetTab(
    userId: string,
    shopTab: string
  ): Promise<{
    success: boolean;
    message: string;
    resetsUsed?: number;
    nextResetCost?: number;
    gemsSpent?: number;
    newGemBalance?: number;
  }> {
    if (!(await this.isOverhaulEnabled(userId))) {
      return { success: false, message: "Shop resets are not available." };
    }

    const periodKeys = this.getPeriodKeys();
    const periodKey = periodKeys[shopTab];
    if (!periodKey) {
      return { success: false, message: `Unknown shop tab: ${shopTab}` };
    }

    const shopDate = this.getCurrentShopDate();
    const client = await db.getClient();

    try {
      await client.query("BEGIN");

      const { rows: userRows } = await client.query(
        `SELECT gems FROM users WHERE user_id = $1 FOR NO KEY UPDATE`,
        [userId]
      );
      if (userRows.length === 0) {
        await client.query("ROLLBACK");
        return { success: false, message: "User not found" };
      }

      const { rows: resetRows } = await client.query(
        `SELECT COALESCE(resets_used, 0)::int AS resets_used
         FROM shop_tab_resets
         WHERE user_id = $1 AND shop_tab = $2 AND period_key = $3`,
        [userId, shopTab, periodKey]
      );
      const resetsUsed: number = resetRows[0]?.resets_used ?? 0;
      const cost = this.getResetCost(resetsUsed);

      const { rows: debitRows } = await client.query(
        `UPDATE users SET gems = gems - $1
         WHERE user_id = $2 AND gems >= $1
         RETURNING gems AS new_balance`,
        [cost, userId]
      );
      if (debitRows.length === 0) {
        await client.query("ROLLBACK");
        return {
          success: false,
          message: `Insufficient gems. A reset costs ${cost} gems.`,
        };
      }

      const updated = await DailyShopModel.incrementTabReset(
        userId,
        shopTab,
        periodKey,
        cost,
        client
      );

      // Clearing the player's own purchase records is what actually "resets"
      // the tab for them — the offerings themselves are shared.
      if (shopTab === "daily" || shopTab === "soul") {
        await DailyShopModel.clearUserPurchasesForTab(
          userId,
          shopDate,
          shopTab,
          client
        );
      }

      await client.query("COMMIT");

      await cacheInvalidation.invalidateAfterShopPurchase(userId, "pack");

      logger.info("Shop tab reset purchased", {
        userId,
        shopTab,
        resetsUsed: updated.resets_used,
        cost,
      });

      return {
        success: true,
        message: `${shopTab} shop reset.`,
        resetsUsed: updated.resets_used,
        nextResetCost: this.getResetCost(updated.resets_used),
        gemsSpent: cost,
        newGemBalance: debitRows[0].new_balance,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      logger.error("Error resetting shop tab:", error as any);
      return { success: false, message: "Failed to reset shop" };
    } finally {
      client.release();
    }
  },

  /**
   * Mock paid-shop ("Vault") listings.
   *
   * Placeholder data until real in-app purchases ship — see
   * docs/iap-implementation-plan.md, whose product IDs and contents these
   * mirror so the eventual swap to a live catalogue is a data change, not a
   * UI change. Nothing here can be purchased: there is no grant path, and the
   * whole tab is behind the `iap-store` flag.
   */
  async getPaidShopListings(userId: string): Promise<any[]> {
    if (!(await FeatureFlagService.isEnabled(userId, SHOP_CONFIG.IAP_FLAG))) {
      return [];
    }

    return [
      {
        product_id: "gems_small",
        name: "Pouch of Gems",
        description: "100 gems",
        price_label: "$1.99",
        grants: { gems: 100 },
        badge: null,
      },
      {
        product_id: "gems_medium",
        name: "Chest of Gems",
        description: "550 gems",
        price_label: "$9.99",
        grants: { gems: 550 },
        badge: "Popular",
      },
      {
        product_id: "gems_large",
        name: "Hoard of Gems",
        description: "1,200 gems",
        price_label: "$19.99",
        grants: { gems: 1200 },
        badge: "Best value",
      },
      {
        product_id: "starter_bundle",
        name: "Starter Bundle",
        description: "300 gems + 5 packs",
        price_label: "$4.99",
        grants: { gems: 300, packs: 5 },
        badge: "One per account",
      },
      {
        product_id: "myth_pass_monthly",
        name: "Myth Pass",
        description: "Monthly rewards, delivered to your mail",
        price_label: "$4.99 / month",
        grants: { gems: 250, fate_coins: 500, packs: 3 },
        badge: "Subscription",
      },
    ];
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
