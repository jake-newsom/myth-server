import PackModel from "../models/pack.model";
import UserModel from "../models/user.model";
import CardModel from "../models/card.model";
import db, { QueryExecutor } from "../config/db.config";
import { Card, Pack } from "../types/database.types";
import { RarityUtils } from "../types/card.types";
import logger from "../utils/logger";
import DailyTaskService from "./dailyTask.service";
import { cacheInvalidation } from "./cache.invalidation.service";
import { USER_LIMITS, SHOP_CONFIG } from "../config/constants";
import FeatureFlagService from "./featureFlag.service";

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
    packId: string,
    packCards: CardWithAbility[],
    executor?: QueryExecutor,
  ): Promise<{
    selectedCards: CardWithAbility[];
    isGodPack: boolean;
    packOpeningId: string;
  }> {
    // Check for God Pack and select cards accordingly
    const isGodPack = this.isGodPack();
    const selectedCards = isGodPack
      ? this.selectGodPackCards(packCards, CARDS_PER_PACK)
      : this.selectRandomCards(packCards, CARDS_PER_PACK);

    if (isGodPack) {
      logger.info("God Pack opened!", { userId, packId });
    }

    // Add the selected cards to user's collection
    await this.addCardsToUserCollection(userId, selectedCards, executor);

    // Log the pack opening to history (returns the new opening's id)
    const packOpeningId = await this.logPackOpening(
      userId,
      packId,
      selectedCards,
      executor,
    );

    // Create the fate pick opportunity. When running inside a transaction the
    // caller defers this until after COMMIT: the fate pick references
    // packOpeningId, which is not visible to other connections until then.
    if (!executor) {
      await this.createFatePickForOpening(
        packOpeningId,
        userId,
        selectedCards,
        packId,
      );
    }

    return { selectedCards, isGodPack, packOpeningId };
  },

  /**
   * Best-effort fate pick creation for a completed opening. Never throws — a
   * fate pick failure must not fail the pack opening that already granted cards.
   */
  async createFatePickForOpening(
    packOpeningId: string,
    userId: string,
    selectedCards: CardWithAbility[],
    packId: string,
  ): Promise<void> {
    if (!packOpeningId) return;

    try {
      const FatePickService = await import("./fatePick.service");
      await FatePickService.default.createFatePickFromPackOpening(
        packOpeningId,
        userId,
        selectedCards,
        packId,
        1, // Cost in wonder coins
      );
    } catch (error) {
      logger.error(
        "Error creating fate pick from pack opening",
        {},
        error instanceof Error ? error : new Error(String(error)),
      );
    }
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
    rarityCounts: Record<string, number>,
  ): Promise<void> {
    try {
      const AchievementService = await import("./achievement.service");
      const CardModel = await import("../models/card.model");

      // Get updated card counts after adding cards to collection
      const totalUniqueCards =
        await CardModel.default.getUserUniqueCardCount(userId);
      const totalMythicCards =
        await CardModel.default.getUserMythicCardCount(userId);
      const uniqueCardsByRarity =
        await CardModel.default.getUserUniqueCardCountByRarity(userId);
      const uniqueCharactersBySetSlug =
        await CardModel.default.getUserUniqueCharactersBySetSlug(userId);

      // Trigger card collection event ONCE with all rarity counts
      await AchievementService.default.triggerAchievementEvent({
        userId,
        eventType: "card_collected",
        eventData: {
          rarityCounts,
          totalUniqueCards,
          totalMythicCards,
          uniqueCardsByRarity,
          uniqueCharactersBySetSlug,
        },
      });
    } catch (error) {
      logger.error(
        "Error processing card collection achievement events",
        {},
        error instanceof Error ? error : new Error(String(error)),
      );
      // Don't fail the pack opening process if achievement processing fails
    }
  },

  async openPack(
    userId: string,
    packId: string,
  ): Promise<PackOpenResult | null> {
    // 1. Verify the pack exists and is available
    const pack = await PackModel.findById(packId);
    if (!pack || !this.isPackAvailable(pack)) {
      throw new Error("Pack is not available for opening");
    }

    // 2. Check if the pack has cards available
    const packCardsCount = await PackModel.getCardCount(packId);
    if (packCardsCount === 0) {
      throw new Error("No cards available in this pack");
    }

    // 3. Get all cards from this pack
    const packCards = await this.getCardsFromPack(packId);
    if (packCards.length === 0) {
      throw new Error("No cards available in this pack");
    }

    // 4. Debit the pack and grant the cards atomically. Previously the debit
    // and the grant were separate unguarded statements: a failure between them
    // consumed the pack without granting cards, and the check-then-act on
    // pack_count let concurrent opens double-spend a single pack.
    let selectedCards: CardWithAbility[];
    let isGodPack: boolean;
    let packOpeningId: string;
    let remainingPacks: number;

    const client = await db.getClient();
    try {
      await client.query("BEGIN");

      // Lock the user row so a concurrent open can't spend the same pack.
      const { rows: lockRows } = await client.query(
        `SELECT pack_count FROM users WHERE user_id = $1 FOR NO KEY UPDATE`,
        [userId],
      );

      if (lockRows.length === 0) {
        await client.query("ROLLBACK");
        throw new Error("User not found");
      }

      if (Number(lockRows[0].pack_count) < 1) {
        await client.query("ROLLBACK");
        throw new Error("User does not have any packs available");
      }

      const { rows: debitRows } = await client.query(
        `UPDATE users SET pack_count = pack_count - 1
          WHERE user_id = $1 AND pack_count >= 1
          RETURNING pack_count`,
        [userId],
      );
      if (debitRows.length === 0) {
        await client.query("ROLLBACK");
        throw new Error("Failed to remove pack from user inventory");
      }
      remainingPacks = Number(debitRows[0].pack_count);

      ({ selectedCards, isGodPack, packOpeningId } =
        await this._openSinglePackCore(userId, packId, packCards, client));

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    // 5. Fate pick is created after COMMIT so it references a visible opening.
    await this.createFatePickForOpening(
      packOpeningId,
      userId,
      selectedCards,
      packId,
    );

    // 6. Invalidate user's card cache since collection changed
    await cacheInvalidation.invalidateAfterPackOpen(userId);

    // 7. Trigger achievement events for pack opening and card collection
    try {
      const AchievementService = await import("./achievement.service");

      // Pack opened event
      await AchievementService.default.triggerAchievementEvent({
        userId,
        eventType: "pack_opened",
        eventData: {
          packId,
          packsOpened: 1,
          packsRemaining: remainingPacks,
        },
      });

      // Count cards by rarity and trigger collection achievements
      const rarityCounts = this._countCardsByRarity(selectedCards);
      await this._triggerCardCollectionAchievements(userId, rarityCounts);
    } catch (error) {
      logger.error(
        "Error processing achievement events",
        {},
        error instanceof Error ? error : new Error(String(error)),
      );
      // Don't fail the pack opening process if achievement processing fails
    }

    // 8. Announce a legendary+ pull in global chat. At most one banner per
    // pack opening (a God Pack can yield several qualifying cards), and
    // fire-and-forget: postPackPullBanner never throws, because the user's
    // cards are the transaction that matters here, not the chat frame.
    void this._postPackPullBanner(userId, selectedCards, pack.name);

    return {
      cards: selectedCards,
      remainingPacks,
      isGodPack,
    };
  },

  /**
   * Bridge from a pack result to the chat banner. Kept private and
   * defensive so no chat failure can affect a pack opening.
   */
  async _postPackPullBanner(
    userId: string,
    cards: CardWithAbility[],
    packName: string | null,
  ): Promise<void> {
    try {
      const [{ default: chatService }, UserModelModule] = await Promise.all([
        import("./chat.service"),
        import("../models/user.model"),
      ]);

      const candidates = cards
        .filter((card) => chatService.isBannerWorthyRarity(card.rarity as any))
        .map((card) => {
          // getCardsFromSet builds a nested `special_ability` object rather
          // than flat ability_* columns.
          const ability = (
            card as unknown as {
              special_ability?: {
                ability_id?: string;
                name?: string;
                description?: string;
              } | null;
            }
          ).special_ability;

          return {
            cardVariantId: card.card_id,
            characterName: card.name,
            rarity: card.rarity as any,
            imageUrl: card.image_url ?? null,
            // Presentation fields so the chat banner's GameCard renders the set
            // icon, tag badge and ability text rather than a bare portrait.
            setId: card.set_id ?? null,
            tags: card.tags ?? [],
            isExclusive: false,
            specialAbility: ability
              ? {
                  abilityId: String(ability.ability_id ?? ""),
                  name: String(ability.name ?? ""),
                  description: String(ability.description ?? ""),
                }
              : null,
            // A freshly pulled card has no equipped border yet.
            equippedBorder: null,
            power: card.base_power,
          };
        });

      if (candidates.length === 0) return;

      const user = await UserModelModule.default.findById(userId);
      if (!user) return;

      await chatService.postPackPullBanner(
        userId,
        user.username,
        candidates,
        packName,
      );
    } catch (error) {
      logger.error(
        "Error posting pack pull chat banner",
        { userId },
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  },

  /**
   * The openable contents of a pack: explicit membership via
   * pack_card_variants, so a pack can mix sets freely. `ch.set_id` is still
   * selected and carried on each card because set drives passive effects and
   * the client renders the set icon -- it just no longer decides what is in
   * the pack.
   */
  async getCardsFromPack(packId: string): Promise<CardWithAbility[]> {
    const db = require("../config/db.config").default;
    const query = `
      SELECT
        cv.card_variant_id, cv.rarity, cv.image_url, cv.attack_animation,
        ch.name, ch.description, ch.type,
        ch.base_power->>'top' as base_power_top,
        ch.base_power->>'right' as base_power_right,
        ch.base_power->>'bottom' as base_power_bottom,
        ch.base_power->>'left' as base_power_left,
        ch.special_ability_id, ch.set_id, ch.tags,
        sa.ability_id as sa_ability_id, sa.name as sa_name, sa.description as sa_description,
        sa.trigger_moments as sa_trigger_moments, sa.parameters as sa_parameters
      FROM "pack_card_variants" pcv
      JOIN "card_variants" cv ON cv.card_variant_id = pcv.card_variant_id
      JOIN "characters" ch ON cv.character_id = ch.character_id
      LEFT JOIN "special_abilities" sa ON ch.special_ability_id = sa.ability_id
      WHERE pcv.pack_id = $1
        AND cv.is_exclusive = false
        AND cv.released_at <= NOW()
        AND ch.released_at <= NOW();
    `;
    const { rows } = await db.query(query, [packId]);

    return rows.map((row: any) => ({
      card_id: row.card_variant_id, // Use card_variant_id as card_id for compatibility
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
    count: number,
  ): CardWithAbility[] {
    // God Pack rarity distribution: 60% legendary, 25% epic, 10% rare, 5% common
    // Every card must be a real full-art variant (+/++/+++). We only ever pick
    // cards that actually exist in the pool at the target rarity -- a God Pack
    // never relabels a base card, because the granted card_variant_id is what
    // determines the art the player receives.
    const godPackRarities = ["legendary", "epic", "rare", "common"];
    const godPackWeights = [60, 25, 10, 5]; // Percentages
    const variantTypes = ["+", "++", "+++"];

    // Group cards by their FULL rarity ("legendary++"), not the base tier, so a
    // lookup for a specific variant can actually hit.
    const cardsByRarity: { [key: string]: CardWithAbility[] } = {};
    cards.forEach((card) => {
      const rarity = String(card.rarity);
      if (!cardsByRarity[rarity]) {
        cardsByRarity[rarity] = [];
      }
      cardsByRarity[rarity].push(card);
    });

    // Every full-art card in the pool, for the last-resort reroll below.
    const allFullArt = cards.filter((card) => String(card.rarity).includes("+"));

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

      // Exact match first: a real card at this base rarity and variant tier.
      let availableCards = cardsByRarity[targetRarity];

      // Reroll the variant tier within the same base rarity -- the player still
      // gets the tier the weights promised, just a different full-art level.
      if (!availableCards || availableCards.length === 0) {
        availableCards = variantTypes
          .map((suffix) => cardsByRarity[`${selectedBaseRarity}${suffix}`] ?? [])
          .flat();
      }

      // Last resort: any full-art card in the pool. Still never a base card.
      if (!availableCards || availableCards.length === 0) {
        availableCards = allFullArt;
      }

      if (availableCards.length > 0) {
        const randomIndex = Math.floor(Math.random() * availableCards.length);
        // Push the pool card as-is: its card_id/rarity already describe a real
        // full-art variant, so there is nothing to override.
        selectedCards.push({ ...availableCards[randomIndex] });
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
    count: number,
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
        ]),
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

  /**
   * Bulk-insert opened cards into the user's collection.
   *
   * Single multi-row INSERT rather than one round trip per card: a 10-pack open
   * was 50 sequential round trips. `executor` lets callers pass a transaction
   * client so the grant commits atomically with the pack/gem debit.
   */
  async addCardsToUserCollection(
    userId: string,
    cards: CardWithAbility[],
    executor?: QueryExecutor,
  ): Promise<void> {
    if (cards.length === 0) return;

    const runner: QueryExecutor = executor ?? db;

    // card.card_id is actually the card_variant_id in the new normalized structure
    const query = `
      INSERT INTO "user_owned_cards" (user_id, card_variant_id, level, xp, created_at)
      SELECT $1, variant_id, 1, 0, NOW()
      FROM UNNEST($2::uuid[]) AS variant_id;
    `;
    await runner.query(query, [userId, cards.map((card) => card.card_id)]);
  },

  /**
   * Record the opening in history and return its id.
   *
   * Returns the new row's id via RETURNING rather than re-querying for the
   * user's most recent opening — that read-back raced with concurrent opens by
   * the same user and could attribute a fate pick to the wrong opening.
   */
  async logPackOpening(
    userId: string,
    packId: string,
    cards: CardWithAbility[],
    executor?: QueryExecutor,
  ): Promise<string> {
    const runner: QueryExecutor = executor ?? db;

    // Extract card IDs for storage
    const cardIds = cards.map((card) => card.card_id);

    // set_id is deliberately left NULL: a pack can mix sets, so there is no
    // single set to attribute an opening to. Pre-pack rows keep theirs.
    const query = `
      INSERT INTO "pack_opening_history" (user_id, pack_id, card_ids)
      VALUES ($1, $2, $3)
      RETURNING pack_opening_id;
    `;

    const { rows } = await runner.query(query, [
      userId,
      packId,
      JSON.stringify(cardIds),
    ]);
    return rows[0]?.pack_opening_id ?? "";
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
      0,
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

  /**
   * Guarantee at least one rare art variant in a 10-pack open.
   *
   * Each of the 50 cards is rolled independently, and the combined `+`/`++`/
   * `+++` weight is 3.5% — so a 10-pack comes up with no variant at all around
   * 17% of the time. That is exactly the outcome that makes the 10-pack button
   * feel identical to ten single opens, which is the thing this is meant to fix.
   *
   * The pass runs AFTER all packs are generated but BEFORE anything is written:
   * the swap has to be visible to the collection insert, the achievement
   * counts, the fate pick and the reveal, or the player is shown a card they do
   * not own.
   *
   * Mutates `packs` in place and returns whether a swap happened.
   *
   * Design notes:
   *  - **Only when there is genuinely none.** A pack that already rolled a
   *    variant is left completely untouched, so this changes the distribution
   *    only in the tail it is meant to cover — it does not inflate the average
   *    variant rate for lucky opens.
   *  - **Base rarity is weighted, not uniform.** A pity variant is drawn with
   *    the same base-tier weights as a naturally rolled one, so the guarantee
   *    cannot become a backdoor legendary faucet.
   *  - **Never invents a card.** It only ever picks a variant that actually
   *    exists in this pack's pool; the granted `card_variant_id` is what the
   *    player receives, so relabelling a base card would grant the wrong thing.
   *    If the pool has no variants at all, it does nothing.
   */
  _applyTenPackVariantPity(
    packs: CardWithAbility[][],
    packCards: CardWithAbility[],
  ): boolean {
    const hasVariant = packs.some((pack) =>
      pack.some((card) => String(card.rarity).includes("+")),
    );
    if (hasVariant) return false;

    const variantPool = packCards.filter((card) =>
      String(card.rarity).includes("+"),
    );
    if (variantPool.length === 0) return false;

    // Group the available variants by base tier so the weighted pick can only
    // land on a tier that actually has stock.
    const byBaseTier: Record<string, CardWithAbility[]> = {};
    for (const card of variantPool) {
      const base = RarityUtils.getBaseRarity(card.rarity as any);
      (byBaseTier[base] ??= []).push(card);
    }

    const weights = Object.entries(SHOP_CONFIG.VARIANT_PITY_BASE_WEIGHTS).filter(
      ([tier]) => (byBaseTier[tier]?.length ?? 0) > 0,
    );
    if (weights.length === 0) return false;

    const totalWeight = weights.reduce((sum, [, w]) => sum + w, 0);
    let roll = Math.random() * totalWeight;
    let chosenTier = weights[0][0];
    for (const [tier, weight] of weights) {
      roll -= weight;
      if (roll <= 0) {
        chosenTier = tier;
        break;
      }
    }

    const candidates = byBaseTier[chosenTier];
    const replacement = { ...candidates[Math.floor(Math.random() * candidates.length)] };

    // Replace one card in a random pack, at a random position: always
    // overwriting the last card of the first pack would make the guarantee
    // visually obvious and predictable in the reveal.
    const packIndex = Math.floor(Math.random() * packs.length);
    const targetPack = packs[packIndex];
    if (targetPack.length === 0) return false;
    const cardIndex = Math.floor(Math.random() * targetPack.length);
    targetPack[cardIndex] = replacement;

    return true;
  },

  getPackRateConfiguration() {
    return {
      cards_per_pack: CARDS_PER_PACK,
      god_pack_chance: GOD_PACK_CHANCE,
      god_pack_rarity_weights: {
        legendary: 50,
        epic: 20,
        rare: 15,
        common: 15,
      },
      rarity_weights: this.getPackRarityWeights(),
      variant_base_tier_chances: {
        legendary: 15,
        epic: 20,
        rare: 30,
        common: 35,
      },
    };
  },

  async openMultiplePacks(userId: string, packId: string, count: number) {
    // 1. Verify the pack exists and is available
    const pack = await PackModel.findById(packId);
    if (!pack || !this.isPackAvailable(pack)) {
      return {
        success: false,
        message: "Pack is not available for opening",
      };
    }

    // 2. Check if the pack has cards available
    const packCardsCount = await PackModel.getCardCount(packId);
    if (packCardsCount === 0) {
      return {
        success: false,
        message: "No cards available in this pack",
      };
    }

    // 3-4. Lock user row, compute costs, check card limit, and deduct
    // resources atomically to prevent concurrent double-spend.
    let packsToUse: number;
    let packsToBuy: number;
    let requiredGems: number;

    const client = await db.getClient();
    try {
      await client.query("BEGIN");

      const { rows: lockRows } = await client.query(
        `SELECT pack_count, gems, (
           SELECT COUNT(*) FROM user_owned_cards WHERE user_id = $1
         ) AS card_count
         FROM users WHERE user_id = $1 FOR NO KEY UPDATE`,
        [userId],
      );

      if (lockRows.length === 0) {
        await client.query("ROLLBACK");
        return { success: false, message: "User not found" };
      }

      const {
        pack_count: userPackCount,
        gems: userGems,
        card_count,
      } = lockRows[0];
      const currentCardCount = Number(card_count);
      packsToUse = Math.min(userPackCount, count);
      packsToBuy = Math.max(0, count - userPackCount);
      requiredGems = 0;

      if (packsToBuy > 0) {
        requiredGems = packsToBuy * 100;
        if (count >= 10) requiredGems = Math.floor(requiredGems * 0.9);
        if (userGems < requiredGems) {
          await client.query("ROLLBACK");
          return {
            success: false,
            message: "Not enough resources to purchase packs",
          };
        }
      }

      if (packsToUse + packsToBuy < count) {
        await client.query("ROLLBACK");
        return {
          success: false,
          message: "Not enough resources to purchase packs",
        };
      }

      const cardsToReceive = count * CARDS_PER_PACK;
      if (currentCardCount + cardsToReceive > USER_LIMITS.MAX_CARDS) {
        await client.query("ROLLBACK");
        return {
          success: false,
          message: `Opening ${count} pack(s) would exceed your card limit of ${USER_LIMITS.MAX_CARDS}. You currently have ${currentCardCount} cards and would receive ${cardsToReceive} more cards.`,
          code: "MAX_CARDS_EXCEEDED",
        };
      }

      if (packsToUse > 0) {
        await client.query(
          `UPDATE users SET pack_count = pack_count - $1 WHERE user_id = $2`,
          [packsToUse, userId],
        );
      }
      if (packsToBuy > 0) {
        const { rows: gemRows } = await client.query(
          `UPDATE users SET gems = gems - $1 WHERE user_id = $2 AND gems >= $1 RETURNING gems`,
          [requiredGems, userId],
        );
        if (gemRows.length === 0) {
          await client.query("ROLLBACK");
          return {
            success: false,
            message: "Not enough resources to purchase packs",
          };
        }
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
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
      // Get all cards from this pack
      const packCards = await this.getCardsFromPack(packId);
      if (packCards.length === 0) {
        throw new Error("No cards available in this pack");
      }

      // Roll every pack's contents FIRST, without persisting anything.
      //
      // The variant guarantee is a property of the whole batch, so it cannot be
      // decided until all packs are rolled — and it has to be applied before
      // the cards are written, because the collection insert, the achievement
      // counts and the fate pick all read the same arrays.
      for (let i = 0; i < count; i++) {
        const isGodPack = this.isGodPack();
        const selectedCards = isGodPack
          ? this.selectGodPackCards(packCards, CARDS_PER_PACK)
          : this.selectRandomCards(packCards, CARDS_PER_PACK);

        if (isGodPack) {
          logger.info("God Pack opened in multiple pack opening!", {
            userId,
            packId,
            packNumber: i + 1,
          });
          godPacks.push(i); // Track this pack as a God Pack (0-indexed)
        }

        packs.push(selectedCards);
      }

      // 10-pack guarantee. Flag-gated: off, the batch is exactly what the rolls
      // produced, which is today's behaviour.
      if (
        count >= SHOP_CONFIG.VARIANT_PITY_MIN_PACKS &&
        (await FeatureFlagService.isEnabled(userId, SHOP_CONFIG.FLAG))
      ) {
        const applied = this._applyTenPackVariantPity(packs, packCards);
        if (applied) {
          logger.info("10-pack variant pity applied", { userId, packId, count });
        }
      }

      // Now persist: grant the cards, log the opening, create the fate pick.
      for (let i = 0; i < packs.length; i++) {
        const selectedCards = packs[i];

        await this.addCardsToUserCollection(userId, selectedCards);
        const packOpeningId = await this.logPackOpening(
          userId,
          packId,
          selectedCards,
        );
        await this.createFatePickForOpening(
          packOpeningId,
          userId,
          selectedCards,
          packId,
        );

        // Count cards by rarity for this pack
        const packRarityCounts = this._countCardsByRarity(selectedCards);
        for (const [rarity, count] of Object.entries(packRarityCounts)) {
          totalRarityCounts[rarity] = (totalRarityCounts[rarity] || 0) + count;
        }
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
            packId,
            packsOpened: count,
            packsRemaining: 0,
          },
        });

        // Card collection achievements - trigger once per rarity with accumulated counts
        await this._triggerCardCollectionAchievements(
          userId,
          totalRarityCounts,
        );
      } catch (error) {
        logger.error(
          "Error processing achievement events",
          {},
          error instanceof Error ? error : new Error(String(error)),
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
          error instanceof Error ? error : new Error(String(error)),
        );
        // Don't fail the pack opening process if tracking fails
      }

      // Announce the single best legendary+ pull across the whole batch.
      // One banner for the batch, not one per pack: a 10-pack open would
      // otherwise post ten banners into global chat at once.
      void this._postPackPullBanner(userId, packs.flat(), pack.name);

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
        error instanceof Error ? error : new Error(String(error)),
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

  /**
   * A pack is openable when it is flagged released and any scheduled release
   * date has passed. Mirrors the WHERE clause in PackModel.findAvailable so
   * the shop listing and the open endpoint cannot disagree.
   */
  /**
   * Back-compat for clients that still POST a setId. The packs migration
   * seeded one pack per released set sharing its name, so we map through
   * the name. Returns null when there is no such pack, which the caller
   * surfaces as a normal "Pack ID is required" 400.
   */
  async resolveLegacySetIdToPackId(setId: string): Promise<string | null> {
    const query = `
      SELECT p.pack_id
      FROM sets s
      JOIN packs p ON p.name = s.name
      WHERE s.set_id = $1
      ORDER BY p.sort_order, p.created_at
      LIMIT 1;
    `;
    try {
      const { rows } = await db.query(query, [setId]);
      return rows[0]?.pack_id ?? null;
    } catch (error) {
      logger.error(
        "Error resolving legacy setId to packId",
        { setId },
        error instanceof Error ? error : new Error(String(error)),
      );
      return null;
    }
  },

  isPackAvailable(pack: Pack): boolean {
    if (!pack.is_released) return false;
    if (!pack.released_at) return true;
    return new Date(pack.released_at).getTime() <= Date.now();
  },
};

export default PackService;
