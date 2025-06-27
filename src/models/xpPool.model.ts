import db from "../config/db.config";
import { UserCardXpPool, XpTransfer } from "../types/database.types";

const XpPoolModel = {
  // Get user's XP pool for a specific card name
  async getXpPool(
    userId: string,
    cardName: string
  ): Promise<UserCardXpPool | null> {
    const query = `
      SELECT user_id, card_name, available_xp, total_earned_xp, created_at, updated_at
      FROM "user_card_xp_pools" 
      WHERE user_id = $1 AND card_name = $2;
    `;
    const { rows } = await db.query(query, [userId, cardName]);
    return rows[0] || null;
  },

  // Get all XP pools for a user
  async getAllXpPools(userId: string): Promise<UserCardXpPool[]> {
    const query = `
      SELECT user_id, card_name, available_xp, total_earned_xp, created_at, updated_at
      FROM "user_card_xp_pools" 
      WHERE user_id = $1
      ORDER BY card_name;
    `;
    const { rows } = await db.query(query, [userId]);
    return rows;
  },

  // Add XP to a card's pool (creates pool if doesn't exist)
  async addXpToPool(
    userId: string,
    cardName: string,
    xpAmount: number
  ): Promise<UserCardXpPool> {
    const query = `
      INSERT INTO "user_card_xp_pools" (user_id, card_name, available_xp, total_earned_xp, created_at, updated_at)
      VALUES ($1, $2, $3, $3, NOW(), NOW())
      ON CONFLICT (user_id, card_name) 
      DO UPDATE SET 
        available_xp = user_card_xp_pools.available_xp + $3,
        total_earned_xp = user_card_xp_pools.total_earned_xp + $3,
        updated_at = NOW()
      RETURNING user_id, card_name, available_xp, total_earned_xp, created_at, updated_at;
    `;
    const { rows } = await db.query(query, [userId, cardName, xpAmount]);
    return rows[0];
  },

  // Spend XP from a pool
  async spendXpFromPool(
    userId: string,
    cardName: string,
    xpAmount: number
  ): Promise<UserCardXpPool | null> {
    const query = `
      UPDATE "user_card_xp_pools" 
      SET available_xp = available_xp - $3,
          updated_at = NOW()
      WHERE user_id = $1 AND card_name = $2 AND available_xp >= $3
      RETURNING user_id, card_name, available_xp, total_earned_xp, created_at, updated_at;
    `;
    const { rows } = await db.query(query, [userId, cardName, xpAmount]);
    return rows[0] || null;
  },

  // Log XP transfer
  async logXpTransfer(
    transfer: Omit<XpTransfer, "id" | "created_at">
  ): Promise<XpTransfer> {
    const query = `
      INSERT INTO "xp_transfers" (
        user_id, transfer_type, source_card_ids, target_card_id, 
        card_name, xp_transferred, efficiency_rate, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      RETURNING id, user_id, transfer_type, source_card_ids, target_card_id, 
                card_name, xp_transferred, efficiency_rate, created_at;
    `;
    const { rows } = await db.query(query, [
      transfer.user_id,
      transfer.transfer_type,
      transfer.source_card_ids || null,
      transfer.target_card_id || null,
      transfer.card_name,
      transfer.xp_transferred,
      transfer.efficiency_rate || null,
    ]);
    return rows[0];
  },

  // Get XP transfer history for a user
  async getXpTransferHistory(
    userId: string,
    cardName?: string,
    limit: number = 50
  ): Promise<XpTransfer[]> {
    let query = `
      SELECT id, user_id, transfer_type, source_card_ids, target_card_id, 
             card_name, xp_transferred, efficiency_rate, created_at
      FROM "xp_transfers" 
      WHERE user_id = $1
    `;
    const values: any[] = [userId];

    if (cardName) {
      query += ` AND card_name = $2`;
      values.push(cardName);
      query += ` ORDER BY created_at DESC LIMIT $3`;
      values.push(limit);
    } else {
      query += ` ORDER BY created_at DESC LIMIT $2`;
      values.push(limit);
    }

    const { rows } = await db.query(query, values);
    return rows;
  },
};

export default XpPoolModel;
