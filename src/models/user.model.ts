import db from "../config/db.config";
import bcrypt from "bcrypt";
import config from "../config";
import { User } from "../types/database.types";

interface UserCreateInput {
  username: string;
  email: string;
  password?: string;
  facebook_id?: string;
  auth_provider?: "local" | "facebook";
}

const UserModel = {
  async create({
    username,
    email,
    password,
    facebook_id,
    auth_provider = "local",
  }: UserCreateInput): Promise<User> {
    let hashedPassword = null;
    if (password) {
      hashedPassword = await bcrypt.hash(password, config.bcryptSaltRounds);
    }

    const query = `
      INSERT INTO "users" (username, email, password_hash, facebook_id, auth_provider, in_game_currency, gold, gems, fate_coins, card_fragments, total_xp, pack_count, win_streak_multiplier, created_at, last_login)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
      RETURNING user_id, username, email, facebook_id, auth_provider, in_game_currency, gems, fate_coins, card_fragments, total_xp, pack_count, win_streak_multiplier, created_at, last_login as last_login_at;
    `;

    const values = [
      username,
      email,
      hashedPassword,
      facebook_id,
      auth_provider,
      0, // in_game_currency
      0, // gold (deprecated, kept for DB compatibility)
      0, // gems
      2, // fate_coins - start new users with 2 fate coins
      0, // card_fragments - start new users with 0 card fragments
      0, // total_xp
      0, // pack_count
      1.0, // win_streak_multiplier - start at 1.0
    ];
    const { rows } = await db.query(query, values);
    return rows[0];
  },

  async findByEmail(email: string): Promise<User | null> {
    const query = `SELECT * FROM "users" WHERE email = $1;`;
    const { rows } = await db.query(query, [email]);
    return rows[0] || null;
  },

  async findByUsername(username: string): Promise<User | null> {
    const query = `SELECT * FROM "users" WHERE username = $1;`;
    const { rows } = await db.query(query, [username]);
    return rows[0] || null;
  },

  async findByFacebookId(facebookId: string): Promise<User | null> {
    const query = `SELECT * FROM "users" WHERE facebook_id = $1;`;
    const { rows } = await db.query(query, [facebookId]);
    return rows[0] || null;
  },

  async findById(userId: string): Promise<User | null> {
    const query = `SELECT user_id, username, email, in_game_currency, gems, fate_coins, card_fragments, total_xp, pack_count, win_streak_multiplier, tower_floor, created_at, last_login as last_login_at FROM "users" WHERE user_id = $1;`;
    const { rows } = await db.query(query, [userId]);
    return rows[0] || null;
  },

  async updateLastLogin(userId: string): Promise<void> {
    const query = `UPDATE "users" SET last_login = NOW() WHERE user_id = $1;`;
    await db.query(query, [userId]);
  },

  // Legacy method - kept for backward compatibility
  async updateCurrency(userId: string, amount: number): Promise<User | null> {
    // Add the specified amount to user's current currency
    const query = `
      UPDATE "users" 
      SET in_game_currency = in_game_currency + $2 
      WHERE user_id = $1
      RETURNING user_id, username, email, in_game_currency, gold, gems, fate_coins, card_fragments, total_xp, pack_count, win_streak_multiplier, created_at, last_login_at;
    `;
    const { rows } = await db.query(query, [userId, amount]);
    return rows[0] || null;
  },

  // New dual currency methods
  async updateGold(userId: string, amount: number): Promise<User | null> {
    const query = `
      UPDATE "users" 
      SET gold = gold + $2 
      WHERE user_id = $1 AND gold + $2 >= 0
      RETURNING user_id, username, email, in_game_currency, gems, fate_coins, card_fragments, total_xp, pack_count, win_streak_multiplier, created_at, last_login as last_login_at;
    `;
    const { rows } = await db.query(query, [userId, amount]);
    return rows[0] || null;
  },

  async updateGems(userId: string, amount: number): Promise<User | null> {
    const query = `
      UPDATE "users" 
      SET gems = gems + $2 
      WHERE user_id = $1 AND gems + $2 >= 0
      RETURNING user_id, username, email, in_game_currency, gems, fate_coins, card_fragments, total_xp, pack_count, win_streak_multiplier, created_at, last_login as last_login_at;
    `;
    const { rows } = await db.query(query, [userId, amount]);
    return rows[0] || null;
  },

  async updateBothCurrencies(
    userId: string,
    goldAmount: number,
    gemsAmount: number
  ): Promise<User | null> {
    const query = `
      UPDATE "users" 
      SET gold = gold + $2, gems = gems + $3 
      WHERE user_id = $1 AND gold + $2 >= 0 AND gems + $3 >= 0
      RETURNING user_id, username, email, in_game_currency, gems, fate_coins, card_fragments, total_xp, pack_count, win_streak_multiplier, created_at, last_login as last_login_at;
    `;
    const { rows } = await db.query(query, [userId, goldAmount, gemsAmount]);
    return rows[0] || null;
  },

  async updateTotalXp(userId: string, amount: number): Promise<User | null> {
    const query = `
      UPDATE "users" 
      SET total_xp = total_xp + $2 
      WHERE user_id = $1
      RETURNING user_id, username, email, in_game_currency, gems, fate_coins, card_fragments, total_xp, pack_count, win_streak_multiplier, created_at, last_login as last_login_at;
    `;
    const { rows } = await db.query(query, [userId, amount]);
    return rows[0] || null;
  },

  async getPackCount(userId: string): Promise<number> {
    const query = `SELECT pack_count FROM "users" WHERE user_id = $1;`;
    const { rows } = await db.query(query, [userId]);
    return rows[0]?.pack_count || 0;
  },

  async addPacks(userId: string, quantity: number): Promise<User | null> {
    // Add the specified number of packs to user's current pack count
    const query = `
      UPDATE "users" 
      SET pack_count = pack_count + $2 
      WHERE user_id = $1
      RETURNING user_id, username, email, in_game_currency, gems, fate_coins, card_fragments, total_xp, pack_count, win_streak_multiplier, created_at, last_login as last_login_at;
    `;
    const { rows } = await db.query(query, [userId, quantity]);
    return rows[0] || null;
  },

  async removePacks(userId: string, quantity: number): Promise<User | null> {
    // First check if user has enough packs
    const currentPackCount = await this.getPackCount(userId);
    if (currentPackCount < quantity) {
      return null; // Not enough packs
    }

    // Remove the specified number of packs
    const query = `
      UPDATE "users" 
      SET pack_count = pack_count - $2 
      WHERE user_id = $1
      RETURNING user_id, username, email, in_game_currency, gems, fate_coins, card_fragments, total_xp, pack_count, win_streak_multiplier, created_at, last_login as last_login_at;
    `;
    const { rows } = await db.query(query, [userId, quantity]);
    return rows[0] || null;
  },

  async setPackCount(userId: string, quantity: number): Promise<User | null> {
    // Set the exact number of packs for a user
    const query = `
      UPDATE "users" 
      SET pack_count = $2 
      WHERE user_id = $1
      RETURNING user_id, username, email, in_game_currency, gems, fate_coins, card_fragments, total_xp, pack_count, win_streak_multiplier, created_at, last_login as last_login_at;
    `;
    const { rows } = await db.query(query, [userId, quantity]);
    return rows[0] || null;
  },

  // Currency spending methods
  async spendGold(userId: string, amount: number): Promise<User | null> {
    const query = `
      UPDATE "users" 
      SET gold = gold - $2 
      WHERE user_id = $1 AND gold >= $2
      RETURNING user_id, username, email, in_game_currency, gems, fate_coins, card_fragments, total_xp, pack_count, win_streak_multiplier, created_at, last_login as last_login_at;
    `;
    const { rows } = await db.query(query, [userId, amount]);
    return rows[0] || null;
  },

  async spendGems(userId: string, amount: number): Promise<User | null> {
    const query = `
      UPDATE "users" 
      SET gems = gems - $2 
      WHERE user_id = $1 AND gems >= $2
      RETURNING user_id, username, email, in_game_currency, gems, fate_coins, card_fragments, total_xp, pack_count, win_streak_multiplier, created_at, last_login as last_login_at;
    `;
    const { rows } = await db.query(query, [userId, amount]);
    return rows[0] || null;
  },

  // Wonder coins methods
  async updateFateCoins(userId: string, amount: number): Promise<User | null> {
    const query = `
      UPDATE "users" 
      SET fate_coins = fate_coins + $2 
      WHERE user_id = $1 AND fate_coins + $2 >= 0
      RETURNING user_id, username, email, in_game_currency, gems, fate_coins, card_fragments, total_xp, pack_count, win_streak_multiplier, created_at, last_login as last_login_at;
    `;
    const { rows } = await db.query(query, [userId, amount]);
    return rows[0] || null;
  },

  async spendFateCoins(userId: string, amount: number): Promise<User | null> {
    const query = `
      UPDATE "users" 
      SET fate_coins = fate_coins - $2 
      WHERE user_id = $1 AND fate_coins >= $2
      RETURNING user_id, username, email, in_game_currency, gems, fate_coins, card_fragments, total_xp, pack_count, win_streak_multiplier, created_at, last_login as last_login_at;
    `;
    const { rows } = await db.query(query, [userId, amount]);
    return rows[0] || null;
  },

  async getFateCoins(userId: string): Promise<number> {
    const query = `SELECT fate_coins FROM "users" WHERE user_id = $1;`;
    const { rows } = await db.query(query, [userId]);
    return rows[0]?.fate_coins || 0;
  },

  // Card fragments methods
  async updateCardFragments(
    userId: string,
    amount: number
  ): Promise<User | null> {
    const query = `
      UPDATE "users" 
      SET card_fragments = card_fragments + $2 
      WHERE user_id = $1 AND card_fragments + $2 >= 0
      RETURNING user_id, username, email, in_game_currency, gems, fate_coins, card_fragments, total_xp, pack_count, win_streak_multiplier, created_at, last_login as last_login_at;
    `;
    const { rows } = await db.query(query, [userId, amount]);
    return rows[0] || null;
  },

  async spendCardFragments(
    userId: string,
    amount: number
  ): Promise<User | null> {
    const query = `
      UPDATE "users" 
      SET card_fragments = card_fragments - $2 
      WHERE user_id = $1 AND card_fragments >= $2
      RETURNING user_id, username, email, in_game_currency, gems, fate_coins, card_fragments, total_xp, pack_count, win_streak_multiplier, created_at, last_login as last_login_at;
    `;
    const { rows } = await db.query(query, [userId, amount]);
    return rows[0] || null;
  },

  async getCardFragments(userId: string): Promise<number> {
    const query = `SELECT card_fragments FROM "users" WHERE user_id = $1;`;
    const { rows } = await db.query(query, [userId]);
    return rows[0]?.card_fragments || 0;
  },

  // Win streak multiplier methods
  async getWinStreakMultiplier(userId: string): Promise<number> {
    const query = `SELECT win_streak_multiplier FROM "users" WHERE user_id = $1;`;
    const { rows } = await db.query(query, [userId]);
    return rows[0]?.win_streak_multiplier || 1.0;
  },

  async incrementWinStreakMultiplier(userId: string): Promise<User | null> {
    // Increment by 0.1, max 5.0
    const query = `
      UPDATE "users" 
      SET win_streak_multiplier = LEAST(win_streak_multiplier + 0.1, 5.0)
      WHERE user_id = $1
      RETURNING user_id, username, email, in_game_currency, gems, fate_coins, card_fragments, total_xp, pack_count, win_streak_multiplier, created_at, last_login as last_login_at;
    `;
    const { rows } = await db.query(query, [userId]);
    return rows[0] || null;
  },

  async resetWinStreakMultiplier(userId: string): Promise<User | null> {
    // Reset to 1.0
    const query = `
      UPDATE "users" 
      SET win_streak_multiplier = 1.0
      WHERE user_id = $1
      RETURNING user_id, username, email, in_game_currency, gems, fate_coins, card_fragments, total_xp, pack_count, win_streak_multiplier, created_at, last_login as last_login_at;
    `;
    const { rows } = await db.query(query, [userId]);
    return rows[0] || null;
  },

  // Account details methods
  async findByIdWithPassword(userId: string): Promise<any | null> {
    const query = `SELECT * FROM "users" WHERE user_id = $1;`;
    const { rows } = await db.query(query, [userId]);
    return rows[0] || null;
  },

  async updateAccountDetails(
    userId: string,
    updates: {
      username?: string;
      email?: string;
      password?: string;
    }
  ): Promise<User | null> {
    const setClauses: string[] = [];
    const values: any[] = [userId];
    let paramIndex = 2;

    if (updates.username !== undefined) {
      setClauses.push(`username = $${paramIndex}`);
      values.push(updates.username);
      paramIndex++;
    }

    if (updates.email !== undefined) {
      setClauses.push(`email = $${paramIndex}`);
      values.push(updates.email);
      paramIndex++;
    }

    if (updates.password !== undefined) {
      const hashedPassword = await bcrypt.hash(
        updates.password,
        config.bcryptSaltRounds
      );
      setClauses.push(`password_hash = $${paramIndex}`);
      values.push(hashedPassword);
      paramIndex++;
    }

    if (setClauses.length === 0) {
      return null; // No updates provided
    }

    const query = `
      UPDATE "users" 
      SET ${setClauses.join(", ")}
      WHERE user_id = $1
      RETURNING user_id, username, email, in_game_currency, gems, fate_coins, card_fragments, total_xp, pack_count, win_streak_multiplier, created_at, last_login as last_login_at;
    `;

    const { rows } = await db.query(query, values);
    return rows[0] || null;
  },

  // Tower floor methods
  async getTowerFloor(userId: string): Promise<number> {
    const query = `SELECT tower_floor FROM "users" WHERE user_id = $1;`;
    const { rows } = await db.query(query, [userId]);
    return rows[0]?.tower_floor || 1;
  },

  async updateTowerFloor(userId: string, floor: number): Promise<User | null> {
    const query = `
      UPDATE "users" 
      SET tower_floor = $2 
      WHERE user_id = $1
      RETURNING user_id, username, email, in_game_currency, gems, fate_coins, card_fragments, total_xp, pack_count, win_streak_multiplier, tower_floor, created_at, last_login as last_login_at;
    `;
    const { rows } = await db.query(query, [userId, floor]);
    return rows[0] || null;
  },

  async incrementTowerFloor(userId: string): Promise<User | null> {
    const query = `
      UPDATE "users" 
      SET tower_floor = tower_floor + 1 
      WHERE user_id = $1
      RETURNING user_id, username, email, in_game_currency, gems, fate_coins, card_fragments, total_xp, pack_count, win_streak_multiplier, tower_floor, created_at, last_login as last_login_at;
    `;
    const { rows } = await db.query(query, [userId]);
    return rows[0] || null;
  },
};

export default UserModel;
