import db from "../config/db.config";
import XpPoolModel from "../models/xpPool.model";
import UserModel from "../models/user.model";
import { CardResponse } from "../types/api.types";

export interface XpReward {
  card_id: string;
  card_name: string;
  xp_gained: number;
  new_xp: number;
  new_level: number;
}

export interface XpTransferResult {
  success: boolean;
  message: string;
  transferred_xp: number;
  source_cards: { card_id: string; xp_lost: number }[];
  target_card: { card_id: string; xp_gained: number; new_level: number };
}

export interface SacrificeResult {
  success: boolean;
  message: string;
  sacrificed_cards: { card_id: string; xp_value: number }[];
  total_xp_gained: number;
  pool_new_total: number;
}

export interface ApplyXpResult {
  success: boolean;
  message: string;
  xp_applied: number;
  new_card_xp: number;
  new_card_level: number;
  pool_remaining: number;
}

const XpService = {
  // Calculate level from XP (simple formula: level = floor(xp/100) + 1, max level 10)
  calculateLevel(xp: number): number {
    const level = Math.floor(xp / 100) + 1;
    return Math.min(level, 10);
  },

  // Calculate XP value of a card for sacrifice (based on level and current XP)
  calculateSacrificeValue(cardXp: number, cardLevel: number): number {
    // Base value + bonus for level
    const baseValue = cardXp;
    const levelBonus = (cardLevel - 1) * 10;
    return Math.floor((baseValue + levelBonus) * 0.5); // 50% efficiency
  },

  // Transfer XP between cards of the same name
  async transferXp(
    userId: string,
    sourceCardIds: string[],
    targetCardId: string,
    xpAmounts: number[]
  ): Promise<XpTransferResult> {
    const client = await db.getClient();

    try {
      await client.query("BEGIN");

      // Get all cards and validate ownership
      const allCardIds = [...sourceCardIds, targetCardId];

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

      // Validate source cards have enough XP
      const sourceCards = rows.filter((card) =>
        sourceCardIds.includes(card.user_card_instance_id)
      );
      for (let i = 0; i < sourceCards.length; i++) {
        if (sourceCards[i].xp < xpAmounts[i]) {
          throw new Error(
            `Card ${sourceCards[i].user_card_instance_id} doesn't have enough XP`
          );
        }
      }

      const targetCard = rows.find(
        (card) => card.user_card_instance_id === targetCardId
      );
      if (!targetCard) {
        throw new Error("Target card not found");
      }

      // Calculate total XP to transfer
      const totalXpToTransfer = xpAmounts.reduce(
        (sum, amount) => sum + amount,
        0
      );
      const efficiency = 0.8; // 80% efficiency for direct transfers
      const actualXpTransferred = Math.floor(totalXpToTransfer * efficiency);

      // Update source cards
      const sourceUpdates = [];
      for (let i = 0; i < sourceCards.length; i++) {
        const newXp = sourceCards[i].xp - xpAmounts[i];
        const newLevel = this.calculateLevel(newXp);

        await client.query(
          `UPDATE "user_owned_cards" SET xp = $1, level = $2 WHERE user_card_instance_id = $3`,
          [newXp, newLevel, sourceCards[i].user_card_instance_id]
        );

        sourceUpdates.push({
          card_id: sourceCards[i].user_card_instance_id,
          xp_lost: xpAmounts[i],
        });
      }

      // Update target card
      const newTargetXp = targetCard.xp + actualXpTransferred;
      const newTargetLevel = this.calculateLevel(newTargetXp);

      await client.query(
        `UPDATE "user_owned_cards" SET xp = $1, level = $2 WHERE user_card_instance_id = $3`,
        [newTargetXp, newTargetLevel, targetCardId]
      );

      // Log the transfer
      await XpPoolModel.logXpTransfer({
        user_id: userId,
        transfer_type: "card_to_card",
        source_card_ids: sourceCardIds,
        target_card_id: targetCardId,
        card_name: cardName,
        xp_transferred: actualXpTransferred,
        efficiency_rate: efficiency,
      });

      await client.query("COMMIT");

      return {
        success: true,
        message: `Transferred ${actualXpTransferred} XP to ${cardName}`,
        transferred_xp: actualXpTransferred,
        source_cards: sourceUpdates,
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
        SELECT uoc.user_card_instance_id, uoc.user_id, uoc.level, uoc.xp, c.name
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

      // Calculate total XP value
      let totalXpValue = 0;
      const sacrificedCards = [];

      for (const card of rows) {
        const xpValue = this.calculateSacrificeValue(card.xp, card.level);
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

      // Log the sacrifice
      await XpPoolModel.logXpTransfer({
        user_id: userId,
        transfer_type: "sacrifice_to_pool",
        source_card_ids: cardIds,
        card_name: cardName,
        xp_transferred: totalXpValue,
        efficiency_rate: 0.5,
      });

      await client.query("COMMIT");

      return {
        success: true,
        message: `Sacrificed ${cardIds.length} ${cardName}(s) for ${totalXpValue} XP`,
        sacrificed_cards: sacrificedCards,
        total_xp_gained: totalXpValue,
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

      await client.query(
        `UPDATE "user_owned_cards" SET xp = $1, level = $2 WHERE user_card_instance_id = $3`,
        [newCardXp, newCardLevel, targetCardId]
      );

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
};

export default XpService;
