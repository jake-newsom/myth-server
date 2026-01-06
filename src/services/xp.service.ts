import db from "../config/db.config";
import XpPoolModel from "../models/xpPool.model";
import UserModel from "../models/user.model";
import { Rarity } from "../types/card.types";
import {
  XpReward,
  XpTransferResult,
  SacrificeResult,
  SacrificeExtrasResult,
  ApplyXpResult,
} from "../types/service.types";
import { XP_CONFIG, RARITY_MULTIPLIERS } from "../config/constants";
import DailyTaskService from "./dailyTask.service";
import { cacheInvalidation } from "./cache.invalidation.service";

const XpService = {
  // Calculate level from XP using new bracket system
  calculateLevel(xp: number): number {
    if (xp < XP_CONFIG.LEVEL_THRESHOLDS.LEVEL_2) return 1;
    if (xp < XP_CONFIG.LEVEL_THRESHOLDS.LEVEL_3) return 2;
    if (xp < XP_CONFIG.LEVEL_THRESHOLDS.LEVEL_4) return 3;
    if (xp < XP_CONFIG.LEVEL_THRESHOLDS.LEVEL_5) return 4;
    return XP_CONFIG.MAX_LEVEL;
  },

  // Calculate XP value of a card for sacrifice based on rarity
  calculateSacrificeValue(
    cardXp: number,
    cardLevel: number,
    rarity: Rarity
  ): number {
    // Base rarity XP values
    if (rarity === "common") return 10;
    if (rarity === "rare") return 20;
    if (rarity === "epic") return 30;
    if (rarity === "legendary") return 50;

    // Enhanced variants (cards with "+" in them)
    if (rarity.includes("+")) return 100;

    // Default fallback (for uncommon or any other rarity)
    return 10;
  },

  // Transfer XP between cards of the same name
  async transferXp(
    userId: string,
    sourceCardId: string,
    targetCardId: string
  ): Promise<XpTransferResult> {
    const client = await db.getClient();

    try {
      await client.query("BEGIN");

      // Get all cards and validate ownership
      const allCardIds = [sourceCardId, targetCardId];

      // Query user cards directly
      const query = `
        SELECT uoc.user_card_instance_id, uoc.user_id, uoc.level, uoc.xp, c.name
        FROM "user_owned_cards" uoc
        JOIN "cards" c ON uoc.card_id = c.card_id
        WHERE uoc.user_card_instance_id = ANY($1) AND uoc.user_id = $2
      `;
      const { rows } = await client.query(query, [allCardIds, userId]);

      if (rows.length !== allCardIds.length) {
        throw new Error("One or more cards don't belong to the user");
      }

      // Check all cards have same name
      const cardNames = [...new Set(rows.map((card) => card.name))];
      if (cardNames.length > 1) {
        throw new Error("All cards must have the same name for XP transfer");
      }
      const cardName = cardNames[0];

      // Get source and target cards
      const sourceCard = rows.find(
        (card) => card.user_card_instance_id === sourceCardId
      );
      const targetCard = rows.find(
        (card) => card.user_card_instance_id === targetCardId
      );

      if (!sourceCard || !targetCard) {
        throw new Error("Source or target card not found");
      }

      // Check source card has XP to transfer
      if (sourceCard.xp <= 0) {
        throw new Error("Source card has no XP to transfer");
      }

      // Transfer 100% of source card's XP
      const totalXpToTransfer = sourceCard.xp;
      const efficiency = 0.8; // 80% efficiency for direct transfers
      const actualXpTransferred = Math.floor(totalXpToTransfer * efficiency);

      // Update source card (set XP to 0 and recalculate level)
      const newSourceXp = 0;
      const newSourceLevel = this.calculateLevel(newSourceXp);

      await client.query(
        `UPDATE "user_owned_cards" SET xp = $1, level = $2 WHERE user_card_instance_id = $3`,
        [newSourceXp, newSourceLevel, sourceCardId]
      );

      // Update target card
      const newTargetXp = targetCard.xp + actualXpTransferred;
      const newTargetLevel = this.calculateLevel(newTargetXp);
      const didLevelUp = newTargetLevel > targetCard.level;

      await client.query(
        `UPDATE "user_owned_cards" SET xp = $1, level = $2 WHERE user_card_instance_id = $3`,
        [newTargetXp, newTargetLevel, targetCardId]
      );

      // Track daily task progress for level up
      if (didLevelUp) {
        try {
          await DailyTaskService.trackLevelUp(userId);
        } catch (error) {
          console.warn("Error tracking level up for daily task:", error);
          // Don't fail the XP transfer if tracking fails
        }
      }

      // Log the transfer
      await XpPoolModel.logXpTransfer({
        user_id: userId,
        transfer_type: "card_to_card",
        source_card_ids: [sourceCardId],
        target_card_id: targetCardId,
        card_name: cardName,
        xp_transferred: actualXpTransferred,
        efficiency_rate: efficiency,
      });

      await client.query("COMMIT");

      // Trigger achievement event for XP transfer (card-to-card)
      try {
        const AchievementService = await import("./achievement.service");

        await AchievementService.default.triggerAchievementEvent({
          userId,
          eventType: "xp_transfer",
          eventData: {
            sourceCardId,
            targetCardId,
            xpTransferred: actualXpTransferred,
          },
        });
      } catch (error) {
        console.warn("Error tracking XP transfer achievement:", error);
        // Don't fail the transfer if achievement tracking fails
      }

      // Trigger achievement event for card leveling if applicable
      if (didLevelUp) {
        try {
          const AchievementService = await import("./achievement.service");
          const CardModel = await import("../models/card.model");
          
          const cardsAtLevelByRarity = await CardModel.default.getUserCardsAtLevelByRarity(userId);
          const isFirstLevelUp = targetCard.level === 1; // Was level 1, now leveled up

          await AchievementService.default.triggerAchievementEvent({
            userId,
            eventType: "card_leveled",
            eventData: {
              cardId: targetCardId,
              newLevel: newTargetLevel,
              isFirstLevelUp,
              cardsAtLevelByRarity,
            },
          });
        } catch (error) {
          console.warn("Error tracking card leveling achievement:", error);
          // Don't fail the transfer if achievement tracking fails
        }
      }

      return {
        success: true,
        message: `Transferred ${actualXpTransferred} XP to ${cardName}`,
        transferred_xp: actualXpTransferred,
        source_cards: [
          {
            card_id: sourceCardId,
            xp_lost: totalXpToTransfer,
          },
        ],
        target_card: {
          card_id: targetCardId,
          xp_gained: actualXpTransferred,
          new_level: newTargetLevel,
        },
      };
    } catch (error) {
      await client.query("ROLLBACK");
      return {
        success: false,
        message: error instanceof Error ? error.message : "XP transfer failed",
        transferred_xp: 0,
        source_cards: [],
        target_card: { card_id: "", xp_gained: 0, new_level: 0 },
      };
    } finally {
      client.release();
    }
  },

  // Sacrifice cards for XP pool
  async sacrificeCards(
    userId: string,
    cardIds: string[]
  ): Promise<SacrificeResult> {
    const client = await db.getClient();

    try {
      await client.query("BEGIN");

      // Get cards and validate ownership
      const query = `
        SELECT uoc.user_card_instance_id, uoc.user_id, uoc.level, uoc.xp, c.name, c.rarity
        FROM "user_owned_cards" uoc
        JOIN "cards" c ON uoc.card_id = c.card_id
        WHERE uoc.user_card_instance_id = ANY($1) AND uoc.user_id = $2
      `;
      const { rows } = await client.query(query, [cardIds, userId]);

      if (rows.length !== cardIds.length) {
        throw new Error("One or more cards don't belong to the user");
      }

      // Check all cards have same name
      const cardNames = [...new Set(rows.map((card) => card.name))];
      if (cardNames.length > 1) {
        throw new Error("All cards must have the same name for sacrifice");
      }
      const cardName = cardNames[0];

      // Calculate total XP value and card fragments
      let totalXpValue = 0;
      const totalCardFragments = cardIds.length; // 1 fragment per card sacrificed
      const sacrificedCards = [];

      for (const card of rows) {
        const xpValue = this.calculateSacrificeValue(
          card.xp,
          card.level,
          card.rarity
        );
        totalXpValue += xpValue;
        sacrificedCards.push({
          card_id: card.user_card_instance_id,
          xp_value: xpValue,
        });
      }

      // Delete the cards
      await client.query(
        `DELETE FROM "user_owned_cards" WHERE user_card_instance_id = ANY($1)`,
        [cardIds]
      );

      // Add XP to pool
      const updatedPool = await XpPoolModel.addXpToPool(
        userId,
        cardName,
        totalXpValue
      );

      // Award card fragments
      await UserModel.updateCardFragments(userId, totalCardFragments);

      // Log the sacrifice
      await XpPoolModel.logXpTransfer({
        user_id: userId,
        transfer_type: "sacrifice_to_pool",
        source_card_ids: cardIds,
        card_name: cardName,
        xp_transferred: totalXpValue,
        efficiency_rate: 1.0, // Fixed 10 XP per card
      });

      await client.query("COMMIT");

      // Invalidate user's card cache since cards were sacrificed
      await cacheInvalidation.invalidateAfterSacrifice(userId);

      // Trigger achievement event for card sacrifice
      try {
        const AchievementService = await import("./achievement.service");
        const totalSacrificed = await XpPoolModel.getTotalSacrificeCount(userId);

        await AchievementService.default.triggerAchievementEvent({
          userId,
          eventType: "card_sacrifice",
          eventData: {
            cardCount: cardIds.length,
            totalSacrificed,
          },
        });
      } catch (error) {
        console.warn("Error tracking card sacrifice achievement:", error);
        // Don't fail the sacrifice if achievement tracking fails
      }

      return {
        success: true,
        message: `Sacrificed ${cardIds.length} ${cardName}(s) for ${totalXpValue} XP and ${totalCardFragments} Card Fragments`,
        sacrificed_cards: sacrificedCards,
        total_xp_gained: totalXpValue,
        total_card_fragments_gained: totalCardFragments,
        pool_new_total: updatedPool.available_xp,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Card sacrifice failed",
        sacrificed_cards: [],
        total_xp_gained: 0,
        total_card_fragments_gained: 0,
        pool_new_total: 0,
      };
    } finally {
      client.release();
    }
  },

  // Sacrifice all extra copies of cards, keeping the 2 highest XP instances per base_card_id
  async sacrificeExtraCards(userId: string): Promise<SacrificeExtrasResult> {
    const client = await db.getClient();

    try {
      await client.query("BEGIN");

      // Get all user's cards grouped by base card (card_id) and card name
      const query = `
        SELECT 
          uoc.user_card_instance_id, 
          uoc.card_id as base_card_id,
          uoc.level, 
          uoc.xp, 
          c.name,
          c.rarity
        FROM "user_owned_cards" uoc
        JOIN "cards" c ON uoc.card_id = c.card_id
        WHERE uoc.user_id = $1
        ORDER BY c.name, uoc.xp DESC, uoc.level DESC, uoc.user_card_instance_id
      `;
      const { rows } = await client.query(query, [userId]);

      // Group cards by base_card_id to determine which to sacrifice
      const cardsByBaseId: { [baseCardId: string]: typeof rows } = {};
      rows.forEach((card) => {
        if (!cardsByBaseId[card.base_card_id]) {
          cardsByBaseId[card.base_card_id] = [];
        }
        cardsByBaseId[card.base_card_id].push(card);
      });

      // Determine which cards to sacrifice: only 0 XP cards, keeping minimum 2 per base_card_id
      const cardsToSacrifice = [];
      for (const [baseCardId, cards] of Object.entries(cardsByBaseId)) {
        // Count cards with XP > 0
        const cardsWithXp = cards.filter((card) => card.xp > 0);
        const cardsWithZeroXp = cards.filter((card) => card.xp === 0);

        // Calculate how many cards we should keep total (at least 2, or all cards with XP if more than 2)
        const minKeep = Math.max(2, cardsWithXp.length);

        // If we have more cards than we need to keep, sacrifice the excess 0 XP cards
        if (cards.length > minKeep) {
          const excessCount = cards.length - minKeep;
          // Only sacrifice from 0 XP cards, up to the excess count
          const toSacrifice = cardsWithZeroXp.slice(
            0,
            Math.min(excessCount, cardsWithZeroXp.length)
          );
          cardsToSacrifice.push(...toSacrifice);
        }
      }

      if (cardsToSacrifice.length === 0) {
        await client.query("ROLLBACK");
        return {
          success: true,
          message: "No 0 XP card copies found to sacrifice",
          sacrificed_cards: [],
          total_xp_gained: 0,
          total_card_fragments_gained: 0,
          pool_new_total: 0,
        };
      }

      // Group cards by name for XP pool updates and by base_card_id for response
      const cardsByName: { [name: string]: typeof cardsToSacrifice } = {};
      const sacrificeCardsByBaseId: {
        [baseCardId: string]: typeof cardsToSacrifice;
      } = {};

      cardsToSacrifice.forEach((card) => {
        // Group by name for XP pools
        if (!cardsByName[card.name]) {
          cardsByName[card.name] = [];
        }
        cardsByName[card.name].push(card);

        // Group by base_card_id for response
        if (!sacrificeCardsByBaseId[card.base_card_id]) {
          sacrificeCardsByBaseId[card.base_card_id] = [];
        }
        sacrificeCardsByBaseId[card.base_card_id].push(card);
      });

      let totalXpGained = 0;
      const totalCardFragments = cardsToSacrifice.length; // 1 fragment per card sacrificed
      const sacrificedCardsByBaseId = [];
      const poolUpdates: { [name: string]: number } = {};

      // Calculate XP value for each base card type
      for (const [baseCardId, cards] of Object.entries(
        sacrificeCardsByBaseId
      )) {
        let baseCardXpGained = 0;
        const cardName = cards[0].name; // All cards with same base_card_id have same name

        for (const card of cards) {
          const xpValue = this.calculateSacrificeValue(
            card.xp,
            card.level,
            card.rarity
          );
          totalXpGained += xpValue;
          baseCardXpGained += xpValue;

          // Track XP per card name for pool updates
          if (!poolUpdates[cardName]) {
            poolUpdates[cardName] = 0;
          }
          poolUpdates[cardName] += xpValue;
        }

        sacrificedCardsByBaseId.push({
          base_card_id: baseCardId,
          card_name: cardName,
          cards_sacrificed: cards.length,
          total_xp_gained: baseCardXpGained,
        });
      }

      // Delete the extra cards
      const cardIdsToDelete = cardsToSacrifice.map(
        (card) => card.user_card_instance_id
      );
      await client.query(
        `DELETE FROM "user_owned_cards" WHERE user_card_instance_id = ANY($1)`,
        [cardIdsToDelete]
      );

      // Update XP pools for each card name and log transfers
      let finalPoolTotal = 0;
      for (const [cardName, xpAmount] of Object.entries(poolUpdates)) {
        const updatedPool = await XpPoolModel.addXpToPool(
          userId,
          cardName,
          xpAmount
        );
        finalPoolTotal += updatedPool.available_xp;

        // Log the sacrifice for this card name
        const cardNamesIds = cardsByName[cardName].map(
          (c) => c.user_card_instance_id
        );
        await XpPoolModel.logXpTransfer({
          user_id: userId,
          transfer_type: "sacrifice_to_pool",
          source_card_ids: cardNamesIds,
          card_name: cardName,
          xp_transferred: xpAmount,
          efficiency_rate: 1.0,
        });
      }

      // Award card fragments
      if (totalCardFragments > 0) {
        await UserModel.updateCardFragments(userId, totalCardFragments);
      }

      await client.query("COMMIT");

      // Invalidate user's card cache since cards were sacrificed
      await cacheInvalidation.invalidateAfterSacrifice(userId);

      // Trigger achievement event for card sacrifice
      try {
        const AchievementService = await import("./achievement.service");
        const totalSacrificed = await XpPoolModel.getTotalSacrificeCount(userId);

        await AchievementService.default.triggerAchievementEvent({
          userId,
          eventType: "card_sacrifice",
          eventData: {
            cardCount: cardsToSacrifice.length,
            totalSacrificed,
          },
        });
      } catch (error) {
        console.warn("Error tracking card sacrifice achievement:", error);
        // Don't fail the sacrifice if achievement tracking fails
      }

      return {
        success: true,
        message: `Sacrificed ${
          cardsToSacrifice.length
        } cards with 0 XP for ${totalXpGained} XP and ${totalCardFragments} Card Fragments across ${
          Object.keys(cardsByName).length
        } different card types`,
        sacrificed_cards: sacrificedCardsByBaseId,
        total_xp_gained: totalXpGained,
        total_card_fragments_gained: totalCardFragments,
        pool_new_total: finalPoolTotal,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Extra card sacrifice failed",
        sacrificed_cards: [],
        total_xp_gained: 0,
        total_card_fragments_gained: 0,
        pool_new_total: 0,
      };
    } finally {
      client.release();
    }
  },

  // Apply XP from pool to card
  async applyXpFromPool(
    userId: string,
    targetCardId: string,
    xpAmount: number
  ): Promise<ApplyXpResult> {
    const client = await db.getClient();

    try {
      await client.query("BEGIN");

      // Get target card and validate ownership
      const query = `
        SELECT uoc.user_card_instance_id, uoc.user_id, uoc.level, uoc.xp, c.name
        FROM "user_owned_cards" uoc
        JOIN "cards" c ON uoc.card_id = c.card_id
        WHERE uoc.user_card_instance_id = $1 AND uoc.user_id = $2
      `;
      const { rows } = await client.query(query, [targetCardId, userId]);

      if (rows.length === 0) {
        throw new Error("Card not found or doesn't belong to user");
      }

      const targetCard = rows[0];

      // Check user has enough XP in pool
      const pool = await XpPoolModel.getXpPool(userId, targetCard.name);
      if (!pool || pool.available_xp < xpAmount) {
        throw new Error(`Not enough XP in ${targetCard.name} pool`);
      }

      // Update card
      const newCardXp = targetCard.xp + xpAmount;
      const newCardLevel = this.calculateLevel(newCardXp);
      const didLevelUp = newCardLevel > targetCard.level;

      await client.query(
        `UPDATE "user_owned_cards" SET xp = $1, level = $2 WHERE user_card_instance_id = $3`,
        [newCardXp, newCardLevel, targetCardId]
      );

      // Track daily task progress for level up
      if (didLevelUp) {
        try {
          await DailyTaskService.trackLevelUp(userId);
        } catch (error) {
          console.warn("Error tracking level up for daily task:", error);
          // Don't fail the XP application if tracking fails
        }

        // Invalidate user's card cache since card leveled up
        await cacheInvalidation.invalidateAfterLevelUp(userId);
      }

      // Update pool
      const updatedPool = await XpPoolModel.spendXpFromPool(
        userId,
        targetCard.name,
        xpAmount
      );

      // Log the application
      await XpPoolModel.logXpTransfer({
        user_id: userId,
        transfer_type: "pool_to_card",
        target_card_id: targetCardId,
        card_name: targetCard.name,
        xp_transferred: xpAmount,
        efficiency_rate: 1.0,
      });

      await client.query("COMMIT");

      // Trigger achievement event for XP transfer (pool-to-card counts as XP transfer)
      try {
        const AchievementService = await import("./achievement.service");

        await AchievementService.default.triggerAchievementEvent({
          userId,
          eventType: "xp_transfer",
          eventData: {
            targetCardId,
            xpTransferred: xpAmount,
            fromPool: true,
          },
        });
      } catch (error) {
        console.warn("Error tracking XP transfer achievement:", error);
        // Don't fail the application if achievement tracking fails
      }

      // Trigger achievement event for card leveling if applicable
      if (didLevelUp) {
        try {
          const AchievementService = await import("./achievement.service");
          const CardModel = await import("../models/card.model");
          
          const cardsAtLevelByRarity = await CardModel.default.getUserCardsAtLevelByRarity(userId);
          const isFirstLevelUp = targetCard.level === 1; // Was level 1, now leveled up

          await AchievementService.default.triggerAchievementEvent({
            userId,
            eventType: "card_leveled",
            eventData: {
              cardId: targetCardId,
              newLevel: newCardLevel,
              isFirstLevelUp,
              cardsAtLevelByRarity,
            },
          });
        } catch (error) {
          console.warn("Error tracking card leveling achievement:", error);
          // Don't fail the application if achievement tracking fails
        }
      }

      return {
        success: true,
        message: `Applied ${xpAmount} XP to ${targetCard.name}`,
        xp_applied: xpAmount,
        new_card_xp: newCardXp,
        new_card_level: newCardLevel,
        pool_remaining: updatedPool?.available_xp || 0,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "XP application failed",
        xp_applied: 0,
        new_card_xp: 0,
        new_card_level: 0,
        pool_remaining: 0,
      };
    } finally {
      client.release();
    }
  },

  // Award XP to pools from game completion
  async awardGameXp(
    userId: string,
    cardRewards: { card_id: string; card_name: string; xp_gained: number }[]
  ): Promise<XpReward[]> {
    const client = await db.getClient();
    const results: XpReward[] = [];

    try {
      await client.query("BEGIN");

      for (const reward of cardRewards) {
        // Add XP to pool
        await XpPoolModel.addXpToPool(
          userId,
          reward.card_name,
          reward.xp_gained
        );

        // Log the reward
        await XpPoolModel.logXpTransfer({
          user_id: userId,
          transfer_type: "game_reward_to_pool",
          card_name: reward.card_name,
          xp_transferred: reward.xp_gained,
        });

        // Get current card stats for response
        const query = `
          SELECT uoc.level, uoc.xp
          FROM "user_owned_cards" uoc
          WHERE uoc.user_card_instance_id = $1 AND uoc.user_id = $2
        `;
        const { rows } = await client.query(query, [reward.card_id, userId]);
        const card = rows[0];

        results.push({
          card_id: reward.card_id,
          card_name: reward.card_name,
          xp_gained: reward.xp_gained,
          new_xp: card?.xp || 0,
          new_level: card?.level || 1,
        });
      }

      // Update user's total XP
      const totalXpGained = cardRewards.reduce(
        (sum, r) => sum + r.xp_gained,
        0
      );
      await UserModel.updateTotalXp(userId, totalXpGained);

      await client.query("COMMIT");
      return results;
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Error awarding game XP:", error);
      return [];
    } finally {
      client.release();
    }
  },

  // Award XP directly to individual cards from game completion
  async awardDirectCardXp(
    userId: string,
    cardRewards: { card_id: string; card_name: string; xp_gained: number }[]
  ): Promise<XpReward[]> {
    const client = await db.getClient();
    const results: XpReward[] = [];
    let anyLevelUp = false;
    let hasFirstLevelUp = false;

    try {
      await client.query("BEGIN");

      for (const reward of cardRewards) {
        // Get current card stats and validate ownership
        const query = `
          SELECT uoc.user_card_instance_id, uoc.level, uoc.xp, c.name
          FROM "user_owned_cards" uoc
          JOIN "cards" c ON uoc.card_id = c.card_id
          WHERE uoc.user_card_instance_id = $1 AND uoc.user_id = $2
        `;
        const { rows } = await client.query(query, [reward.card_id, userId]);

        if (rows.length === 0) {
          console.warn(`Card ${reward.card_id} not found for user ${userId}`);
          continue;
        }

        const card = rows[0];

        // Update card XP and level
        const newXp = card.xp + reward.xp_gained;
        const newLevel = this.calculateLevel(newXp);
        const didLevelUp = newLevel > card.level;

        if (didLevelUp) {
          anyLevelUp = true;
          if (card.level === 1) {
            hasFirstLevelUp = true;
          }
        }

        await client.query(
          `UPDATE "user_owned_cards" SET xp = $1, level = $2 WHERE user_card_instance_id = $3`,
          [newXp, newLevel, reward.card_id]
        );

        // Log the direct card XP award (using pool_to_card type temporarily)
        await XpPoolModel.logXpTransfer({
          user_id: userId,
          transfer_type: "pool_to_card",
          target_card_id: reward.card_id,
          card_name: reward.card_name,
          xp_transferred: reward.xp_gained,
          efficiency_rate: 1.0,
        });

        // Track daily task progress for level up
        if (didLevelUp) {
          try {
            await DailyTaskService.trackLevelUp(userId);
          } catch (error) {
            console.warn("Error tracking level up for daily task:", error);
            // Don't fail the XP award if tracking fails
          }
        }

        results.push({
          card_id: reward.card_id,
          card_name: reward.card_name,
          xp_gained: reward.xp_gained,
          new_xp: newXp,
          new_level: newLevel,
        });
      }

      // Update user's total XP
      const totalXpGained = cardRewards.reduce(
        (sum, r) => sum + r.xp_gained,
        0
      );
      await UserModel.updateTotalXp(userId, totalXpGained);

      await client.query("COMMIT");

      // Trigger achievement event for card leveling if any cards leveled up
      if (anyLevelUp) {
        try {
          const AchievementService = await import("./achievement.service");
          const CardModel = await import("../models/card.model");
          
          const cardsAtLevelByRarity = await CardModel.default.getUserCardsAtLevelByRarity(userId);
          
          // Find the highest level achieved in this batch
          const maxLevel = Math.max(...results.map(r => r.new_level));

          await AchievementService.default.triggerAchievementEvent({
            userId,
            eventType: "card_leveled",
            eventData: {
              newLevel: maxLevel,
              isFirstLevelUp: hasFirstLevelUp,
              cardsAtLevelByRarity,
            },
          });
        } catch (error) {
          console.warn("Error tracking card leveling achievement:", error);
          // Don't fail the XP award if achievement tracking fails
        }
      }

      return results;
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Error awarding direct card XP:", error);
      return [];
    } finally {
      client.release();
    }
  },
};

export default XpService;
