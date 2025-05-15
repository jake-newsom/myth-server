import db from "../config/db.config";
import bcrypt from "bcrypt";
import config from "../config";

interface UserCreateInput {
  username: string;
  email: string;
  password: string;
}

interface User {
  user_id: string;
  username: string;
  email: string;
  in_game_currency: number;
  created_at: Date;
  last_login_at: Date;
}

const UserModel = {
  async create({ username, email, password }: UserCreateInput): Promise<User> {
    const hashedPassword = await bcrypt.hash(password, config.bcryptSaltRounds);
    const query = `
      INSERT INTO "Users" (username, email, password_hash, in_game_currency, created_at, last_login_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      RETURNING user_id, username, email, in_game_currency, created_at, last_login_at;
    `;
    // Initial currency can be set here if different from DB default
    const values = [username, email, hashedPassword, 0];
    const { rows } = await db.query(query, values);
    return rows[0];
  },

  async findByEmail(email: string): Promise<User | null> {
    const query = `SELECT * FROM "Users" WHERE email = $1;`;
    const { rows } = await db.query(query, [email]);
    return rows[0] || null;
  },

  async findByUsername(username: string): Promise<User | null> {
    const query = `SELECT * FROM "Users" WHERE username = $1;`;
    const { rows } = await db.query(query, [username]);
    return rows[0] || null;
  },

  async findById(userId: string): Promise<User | null> {
    const query = `SELECT user_id, username, email, in_game_currency, created_at, last_login_at FROM "Users" WHERE user_id = $1;`;
    const { rows } = await db.query(query, [userId]);
    return rows[0] || null;
  },

  async updateLastLogin(userId: string): Promise<void> {
    const query = `UPDATE "Users" SET last_login_at = NOW() WHERE user_id = $1;`;
    await db.query(query, [userId]);
  },

  async updateCurrency(userId: string, amount: number): Promise<User | null> {
    // Add the specified amount to user's current currency
    const query = `
      UPDATE "Users" 
      SET in_game_currency = in_game_currency + $2 
      WHERE user_id = $1
      RETURNING user_id, username, email, in_game_currency, created_at, last_login_at;
    `;
    const { rows } = await db.query(query, [userId, amount]);
    return rows[0] || null;
  },
};

export default UserModel;
