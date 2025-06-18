import db from "../config/db.config";
import bcrypt from "bcrypt";
import config from "../config";
import { User } from "../types/database.types";

interface UserCreateInput {
  username: string;
  email: string;
  password: string;
}

const UserModel = {
  async create({ username, email, password }: UserCreateInput): Promise<User> {
    const hashedPassword = await bcrypt.hash(password, config.bcryptSaltRounds);
    const query = `
      INSERT INTO "users" (username, email, password_hash, in_game_currency, pack_count, created_at, last_login)
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      RETURNING user_id, username, email, in_game_currency, pack_count, created_at, last_login as last_login_at;
    `;
    // Initial currency and pack count can be set here if different from DB default
    const values = [username, email, hashedPassword, 0, 0];
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

  async findById(userId: string): Promise<User | null> {
    const query = `SELECT user_id, username, email, in_game_currency, pack_count, created_at, last_login as last_login_at FROM "users" WHERE user_id = $1;`;
    const { rows } = await db.query(query, [userId]);
    return rows[0] || null;
  },

  async updateLastLogin(userId: string): Promise<void> {
    const query = `UPDATE "users" SET last_login = NOW() WHERE user_id = $1;`;
    await db.query(query, [userId]);
  },

  async updateCurrency(userId: string, amount: number): Promise<User | null> {
    // Add the specified amount to user's current currency
    const query = `
      UPDATE "users" 
      SET in_game_currency = in_game_currency + $2 
      WHERE user_id = $1
      RETURNING user_id, username, email, in_game_currency, pack_count, created_at, last_login_at;
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
      RETURNING user_id, username, email, in_game_currency, pack_count, created_at, last_login as last_login_at;
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
      RETURNING user_id, username, email, in_game_currency, pack_count, created_at, last_login as last_login_at;
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
      RETURNING user_id, username, email, in_game_currency, pack_count, created_at, last_login as last_login_at;
    `;
    const { rows } = await db.query(query, [userId, quantity]);
    return rows[0] || null;
  },
};

export default UserModel;
