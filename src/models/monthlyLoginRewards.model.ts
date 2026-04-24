import db, { QueryExecutor } from "../config/db.config";
import {
  MonthlyLoginConfig,
  UserMonthlyLoginProgress,
  MonthlyRewardType,
} from "../types/database.types";

const MonthlyLoginRewardsModel = {
  // Configuration Management
  async getRewardConfig(): Promise<MonthlyLoginConfig[]> {
    const query = `
      SELECT config_id, day, reward_type, amount, card_id, is_active, created_at, updated_at
      FROM monthly_login_config
      WHERE is_active = true
      ORDER BY day;
    `;
    const { rows } = await db.query(query);
    return rows;
  },

  async getRewardConfigByDay(day: number): Promise<MonthlyLoginConfig | null> {
    const query = `
      SELECT config_id, day, reward_type, amount, card_id, is_active, created_at, updated_at
      FROM monthly_login_config
      WHERE day = $1 AND is_active = true;
    `;
    const { rows } = await db.query(query, [day]);
    return rows[0] || null;
  },

  async createRewardConfig(
    config: Omit<MonthlyLoginConfig, "config_id" | "created_at" | "updated_at">
  ): Promise<MonthlyLoginConfig> {
    const query = `
      INSERT INTO monthly_login_config (day, reward_type, amount, card_id, is_active)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING config_id, day, reward_type, amount, card_id, is_active, created_at, updated_at;
    `;
    const { rows } = await db.query(query, [
      config.day,
      config.reward_type,
      config.amount,
      config.card_id || null,
      config.is_active,
    ]);
    return rows[0];
  },

  async updateRewardConfig(
    day: number,
    updates: Partial<
      Omit<MonthlyLoginConfig, "config_id" | "day" | "created_at" | "updated_at">
    >
  ): Promise<MonthlyLoginConfig | null> {
    const setClause = [];
    const values = [];
    let paramIndex = 2;

    if (updates.reward_type !== undefined) {
      setClause.push(`reward_type = $${paramIndex++}`);
      values.push(updates.reward_type);
    }
    if (updates.amount !== undefined) {
      setClause.push(`amount = $${paramIndex++}`);
      values.push(updates.amount);
    }
    if (updates.card_id !== undefined) {
      setClause.push(`card_id = $${paramIndex++}`);
      values.push(updates.card_id);
    }
    if (updates.is_active !== undefined) {
      setClause.push(`is_active = $${paramIndex++}`);
      values.push(updates.is_active);
    }

    if (setClause.length === 0) {
      return null;
    }

    setClause.push("updated_at = current_timestamp");

    const query = `
      UPDATE monthly_login_config
      SET ${setClause.join(", ")}
      WHERE day = $1
      RETURNING config_id, day, reward_type, amount, card_id, is_active, created_at, updated_at;
    `;

    const { rows } = await db.query(query, [day, ...values]);
    return rows[0] || null;
  },

  // User Progress Management
  async getUserProgress(
    userId: string,
    monthYear: string
  ): Promise<UserMonthlyLoginProgress | null> {
    const query = `
      SELECT progress_id, user_id, month_year, current_day, claimed_days, last_claim_date, created_at, updated_at
      FROM user_monthly_login_progress
      WHERE user_id = $1 AND month_year = $2;
    `;
    const { rows } = await db.query(query, [userId, monthYear]);
    return rows[0] || null;
  },

  async createUserProgress(
    userId: string,
    monthYear: string
  ): Promise<UserMonthlyLoginProgress> {
    const query = `
      INSERT INTO user_monthly_login_progress (user_id, month_year, current_day, claimed_days, last_claim_date)
      VALUES ($1, $2, 0, '{}', NULL)
      RETURNING progress_id, user_id, month_year, current_day, claimed_days, last_claim_date, created_at, updated_at;
    `;
    const { rows } = await db.query(query, [userId, monthYear]);
    return rows[0];
  },

  async updateUserProgress(
    userId: string,
    monthYear: string,
    currentDay: number,
    claimedDays: number[],
    lastClaimDate?: Date | string | null
  ): Promise<UserMonthlyLoginProgress | null> {
    const query = `
      UPDATE user_monthly_login_progress
      SET current_day = $3, claimed_days = $4, last_claim_date = COALESCE($5, last_claim_date), updated_at = current_timestamp
      WHERE user_id = $1 AND month_year = $2
      RETURNING progress_id, user_id, month_year, current_day, claimed_days, last_claim_date, created_at, updated_at;
    `;
    const { rows } = await db.query(query, [
      userId,
      monthYear,
      currentDay,
      claimedDays,
      lastClaimDate || null,
    ]);
    return rows[0] || null;
  },

  async addClaimedDay(
    userId: string,
    monthYear: string,
    day: number,
    claimDate?: Date | string,
    client?: QueryExecutor
  ): Promise<UserMonthlyLoginProgress | null> {
    const lastClaimDate = claimDate || new Date().toISOString().split('T')[0];
    // Single atomic UPDATE: append the day to claimed_days and advance current_day
    // in one round-trip, eliminating the read-then-write race condition.
    const query = `
      UPDATE user_monthly_login_progress
      SET
        claimed_days   = array(SELECT DISTINCT unnest(claimed_days || ARRAY[$3::int]) ORDER BY 1),
        current_day    = GREATEST(current_day, $3),
        last_claim_date = $4,
        updated_at     = current_timestamp
      WHERE user_id = $1 AND month_year = $2
      RETURNING progress_id, user_id, month_year, current_day, claimed_days, last_claim_date, created_at, updated_at;
    `;
    const executor: QueryExecutor = client ?? db;
    const { rows } = await executor.query(query, [userId, monthYear, day, lastClaimDate]);
    return rows[0] || null;
  },

  // Batch operations for monthly reset
  async resetAllUserProgress(): Promise<number> {
    const query = `
      DELETE FROM user_monthly_login_progress;
    `;
    const result = await db.query(query);
    return result.rowCount || 0;
  },

  // Enhanced card selection (for day 24 reward)
  async getRandomEnhancedCard(): Promise<string | null> {
    const countQuery = `
      SELECT COUNT(*)::int as total
      FROM card_variants
      WHERE rarity::text ~ '^(common|uncommon|rare|epic|legendary)\\+{1,3}$'
        AND is_exclusive = false;
    `;
    const { rows: countRows } = await db.query(countQuery);
    const total = Number(countRows[0]?.total || 0);
    if (total === 0) {
      return null;
    }

    const randomOffset = Math.floor(Math.random() * total);
    const query = `
      SELECT card_variant_id as card_id
      FROM card_variants
      WHERE rarity::text ~ '^(common|uncommon|rare|epic|legendary)\\+{1,3}$'
        AND is_exclusive = false
      ORDER BY card_variant_id
      LIMIT 1 OFFSET $1;
    `;
    const { rows } = await db.query(query, [randomOffset]);
    return rows[0]?.card_id || null;
  },
};

export default MonthlyLoginRewardsModel;

