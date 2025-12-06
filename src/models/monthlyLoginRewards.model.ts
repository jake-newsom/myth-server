import db from "../config/db.config";
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
    claimDate?: Date | string
  ): Promise<UserMonthlyLoginProgress | null> {
    // Get current progress
    const progress = await this.getUserProgress(userId, monthYear);
    if (!progress) {
      return null;
    }

    // Add day to claimed_days if not already claimed
    const claimedDays = progress.claimed_days.includes(day)
      ? progress.claimed_days
      : [...progress.claimed_days, day].sort((a, b) => a - b);

    // Update current_day if this day is higher
    const currentDay = Math.max(progress.current_day, day);

    // Use provided claimDate or current UTC date
    const lastClaimDate = claimDate || new Date().toISOString().split('T')[0];

    return await this.updateUserProgress(
      userId,
      monthYear,
      currentDay,
      claimedDays,
      lastClaimDate
    );
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
    const query = `
      SELECT card_id
      FROM cards
      WHERE rarity::text ~ '^(common|uncommon|rare|epic|legendary)\\+{1,3}$'
      ORDER BY RANDOM()
      LIMIT 1;
    `;
    const { rows } = await db.query(query);
    return rows[0]?.card_id || null;
  },
};

export default MonthlyLoginRewardsModel;

