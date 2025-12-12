import db from "../config/db.config";
import {
  Achievement,
  UserAchievement,
  UserAchievementWithDetails,
} from "../types/database.types";

const AchievementModel = {
  /**
   * Get all achievements
   */
  async getAllAchievements(
    includeInactive: boolean = false
  ): Promise<Achievement[]> {
    const query = `
      SELECT * FROM achievements
      ${includeInactive ? "" : "WHERE is_active = true"}
      ORDER BY sort_order ASC, created_at ASC;
    `;

    const { rows } = await db.query(query);
    return rows;
  },

  /**
   * Get achievements by category
   */
  async getAchievementsByCategory(
    category: string,
    includeInactive: boolean = false
  ): Promise<Achievement[]> {
    const query = `
      SELECT * FROM achievements
      WHERE category = $1 ${includeInactive ? "" : "AND is_active = true"}
      ORDER BY sort_order ASC, created_at ASC;
    `;

    const { rows } = await db.query(query, [category]);
    return rows;
  },

  /**
   * Get achievement by key
   */
  async getAchievementByKey(
    achievementKey: string
  ): Promise<Achievement | null> {
    const query = `
      SELECT * FROM achievements
      WHERE achievement_key = $1;
    `;

    const { rows } = await db.query(query, [achievementKey]);
    return rows.length > 0 ? rows[0] : null;
  },

  /**
   * Get achievement by ID
   */
  async getAchievementById(achievementId: string): Promise<Achievement | null> {
    const query = `
      SELECT * FROM achievements
      WHERE id = $1;
    `;

    const { rows } = await db.query(query, [achievementId]);
    return rows.length > 0 ? rows[0] : null;
  },

  /**
   * Get user's achievement progress
   */
  async getUserAchievement(
    userId: string,
    achievementId: string
  ): Promise<UserAchievement | null> {
    const query = `
      SELECT * FROM user_achievements
      WHERE user_id = $1 AND achievement_id = $2;
    `;

    const { rows } = await db.query(query, [userId, achievementId]);
    return rows.length > 0 ? rows[0] : null;
  },

  /**
   * Get user's achievement progress by achievement key
   */
  async getUserAchievementByKey(
    userId: string,
    achievementKey: string
  ): Promise<UserAchievementWithDetails | null> {
    const query = `
      SELECT 
        ua.*,
        a.*,
        CASE 
          WHEN a.target_value > 0 
          THEN ROUND((ua.current_progress::DECIMAL / a.target_value * 100), 2)
          ELSE 0 
        END as progress_percentage,
        (ua.is_completed = true AND ua.is_claimed = false) as can_claim,
        CASE 
          WHEN a.tier_level IS NULL THEN true
          WHEN a.tier_level = 1 THEN true
          ELSE EXISTS (
            SELECT 1 FROM user_achievements ua_prev
            JOIN achievements prev ON prev.base_achievement_key = a.base_achievement_key 
              AND prev.tier_level = a.tier_level - 1
            WHERE ua_prev.user_id = $1 
              AND ua_prev.achievement_id = prev.id 
              AND ua_prev.is_completed = true
          )
        END as is_unlocked
      FROM user_achievements ua
      JOIN achievements a ON ua.achievement_id = a.id
      WHERE ua.user_id = $1 AND a.achievement_key = $2;
    `;

    const { rows } = await db.query(query, [userId, achievementKey]);

    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      id: row.id,
      user_id: row.user_id,
      achievement_id: row.achievement_id,
      current_progress: row.current_progress,
      is_completed: row.is_completed,
      completed_at: row.completed_at,
      claimed_at: row.claimed_at,
      is_claimed: row.is_claimed,
      created_at: row.created_at,
      updated_at: row.updated_at,
      achievement: {
        id: row.achievement_id,
        achievement_key: row.achievement_key,
        title: row.title,
        description: row.description,
        category: row.category,
        type: row.type,
        target_value: row.target_value,
        rarity: row.rarity,
        reward_gems: row.reward_gems,
        reward_fate_coins: row.reward_fate_coins || undefined,
        reward_packs: row.reward_packs,
        reward_card_fragments: row.reward_card_fragments || undefined,
        icon_url: row.icon_url,
        is_active: row.is_active,
        sort_order: row.sort_order,
        base_achievement_key: row.base_achievement_key,
        tier_level: row.tier_level,
        story_id: row.story_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
      progress_percentage: parseFloat(row.progress_percentage),
      can_claim: row.can_claim,
      is_unlocked: row.is_unlocked,
    };
  },

  /**
   * Get all user achievements with details
   */
  async getUserAchievementsWithDetails(
    userId: string,
    category?: string,
    completedOnly: boolean = false,
    unclaimedOnly: boolean = false
  ): Promise<UserAchievementWithDetails[]> {
    let whereConditions = ["ua.user_id = $1", "a.is_active = true"];
    const params = [userId];
    let paramIndex = 2;

    if (category) {
      whereConditions.push(`a.category = $${paramIndex}`);
      params.push(category);
      paramIndex++;
    }

    if (completedOnly) {
      whereConditions.push("ua.is_completed = true");
    }

    if (unclaimedOnly) {
      whereConditions.push("ua.is_completed = true AND ua.is_claimed = false");
    }

    const query = `
      SELECT 
        ua.*,
        a.id as achievement_db_id,
        a.achievement_key,
        a.title,
        a.description,
        a.category,
        a.type,
        a.target_value,
        a.rarity,
        a.reward_gems,
        a.reward_fate_coins,
        a.reward_packs,
        a.reward_card_fragments,
        a.icon_url,
        a.is_active,
        a.sort_order,
        a.base_achievement_key,
        a.tier_level,
        a.story_id,
        a.created_at as achievement_created_at,
        a.updated_at as achievement_updated_at,
        CASE 
          WHEN a.target_value > 0 
          THEN ROUND((ua.current_progress::DECIMAL / a.target_value * 100), 2)
          ELSE 0 
        END as progress_percentage,
        (ua.is_completed = true AND ua.is_claimed = false) as can_claim,
        CASE 
          WHEN a.tier_level IS NULL THEN true
          WHEN a.tier_level = 1 THEN true
          ELSE EXISTS (
            SELECT 1 FROM user_achievements ua_prev
            JOIN achievements prev ON prev.base_achievement_key = a.base_achievement_key 
              AND prev.tier_level = a.tier_level - 1
            WHERE ua_prev.user_id = $1 
              AND ua_prev.achievement_id = prev.id 
              AND ua_prev.is_completed = true
          )
        END as is_unlocked
      FROM user_achievements ua
      JOIN achievements a ON ua.achievement_id = a.id
      WHERE ${whereConditions.join(" AND ")}
      ORDER BY a.sort_order ASC, a.tier_level ASC, a.created_at ASC;
    `;

    const { rows } = await db.query(query, params);

    return rows.map((row) => ({
      id: row.id,
      user_id: row.user_id,
      achievement_id: row.achievement_id,
      current_progress: row.current_progress,
      is_completed: row.is_completed,
      completed_at: row.completed_at,
      claimed_at: row.claimed_at,
      is_claimed: row.is_claimed,
      created_at: row.created_at,
      updated_at: row.updated_at,
      achievement: {
        id: row.achievement_db_id,
        achievement_key: row.achievement_key,
        title: row.title,
        description: row.description,
        category: row.category,
        type: row.type,
        target_value: row.target_value,
        rarity: row.rarity,
        reward_gems: row.reward_gems,
        reward_fate_coins: row.reward_fate_coins || undefined,
        reward_packs: row.reward_packs,
        reward_card_fragments: row.reward_card_fragments || undefined,
        icon_url: row.icon_url,
        is_active: row.is_active,
        sort_order: row.sort_order,
        base_achievement_key: row.base_achievement_key,
        tier_level: row.tier_level,
        story_id: row.story_id,
        created_at: row.achievement_created_at,
        updated_at: row.achievement_updated_at,
      },
      progress_percentage: parseFloat(row.progress_percentage),
      can_claim: row.can_claim,
      is_unlocked: row.is_unlocked,
    }));
  },

  /**
   * Get all achievements for a user (including not started ones)
   * Filters out locked tiers by default
   */
  async getAllUserAchievements(
    userId: string,
    category?: string,
    includeLocked: boolean = false
  ): Promise<UserAchievementWithDetails[]> {
    let whereConditions = ["a.is_active = true"];
    const params = [userId];
    let paramIndex = 2;

    if (category) {
      whereConditions.push(`a.category = $${paramIndex}`);
      params.push(category);
      paramIndex++;
    }

    // Filter out locked tiers unless includeLocked is true
    if (!includeLocked) {
      whereConditions.push(`
        (a.tier_level IS NULL OR a.tier_level = 1 OR EXISTS (
          SELECT 1 FROM user_achievements ua_prev
          JOIN achievements prev ON prev.base_achievement_key = a.base_achievement_key 
            AND prev.tier_level = a.tier_level - 1
          WHERE ua_prev.user_id = $1 
            AND ua_prev.achievement_id = prev.id 
            AND ua_prev.is_completed = true
        ))
      `);
    }

    const query = `
      SELECT 
        a.*,
        COALESCE(ua.id, null) as user_achievement_id,
        COALESCE(ua.current_progress, 0) as current_progress,
        COALESCE(ua.is_completed, false) as is_completed,
        ua.completed_at,
        ua.claimed_at,
        COALESCE(ua.is_claimed, false) as is_claimed,
        COALESCE(ua.created_at, null) as ua_created_at,
        COALESCE(ua.updated_at, null) as ua_updated_at,
        CASE 
          WHEN a.target_value > 0 
          THEN ROUND((COALESCE(ua.current_progress, 0)::DECIMAL / a.target_value * 100), 2)
          ELSE 0 
        END as progress_percentage,
        (COALESCE(ua.is_completed, false) = true AND COALESCE(ua.is_claimed, false) = false) as can_claim,
        CASE 
          WHEN a.tier_level IS NULL THEN true
          WHEN a.tier_level = 1 THEN true
          ELSE EXISTS (
            SELECT 1 FROM user_achievements ua_prev
            JOIN achievements prev ON prev.base_achievement_key = a.base_achievement_key 
              AND prev.tier_level = a.tier_level - 1
            WHERE ua_prev.user_id = $1 
              AND ua_prev.achievement_id = prev.id 
              AND ua_prev.is_completed = true
          )
        END as is_unlocked
      FROM achievements a
      LEFT JOIN user_achievements ua ON a.id = ua.achievement_id AND ua.user_id = $1
      WHERE ${whereConditions.join(" AND ")}
      ORDER BY a.sort_order ASC, a.tier_level ASC, a.created_at ASC;
    `;

    const { rows } = await db.query(query, params);

    return rows.map((row) => ({
      id: row.user_achievement_id,
      user_id: userId,
      achievement_id: row.id,
      current_progress: row.current_progress,
      is_completed: row.is_completed,
      completed_at: row.completed_at,
      claimed_at: row.claimed_at,
      is_claimed: row.is_claimed,
      created_at: row.ua_created_at,
      updated_at: row.ua_updated_at,
      achievement: {
        id: row.id,
        achievement_key: row.achievement_key,
        title: row.title,
        description: row.description,
        category: row.category,
        type: row.type,
        target_value: row.target_value,
        rarity: row.rarity,
        reward_gems: row.reward_gems,
        reward_fate_coins: row.reward_fate_coins || undefined,
        reward_packs: row.reward_packs,
        reward_card_fragments: row.reward_card_fragments || undefined,
        icon_url: row.icon_url,
        is_active: row.is_active,
        sort_order: row.sort_order,
        base_achievement_key: row.base_achievement_key,
        tier_level: row.tier_level,
        story_id: row.story_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
      progress_percentage: parseFloat(row.progress_percentage),
      can_claim: row.can_claim,
      is_unlocked: row.is_unlocked,
    }));
  },

  /**
   * Create or update user achievement progress
   */
  async updateUserAchievementProgress(
    userId: string,
    achievementKey: string,
    progressIncrement: number = 1
  ): Promise<UserAchievement | null> {
    // First get the achievement
    const achievement = await this.getAchievementByKey(achievementKey);
    if (!achievement) {
      console.warn(`Achievement not found: ${achievementKey}`);
      return null;
    }

    // Validate parameters
    if (!userId || typeof userId !== "string") {
      console.error("Invalid userId:", userId);
      return null;
    }
    if (typeof progressIncrement !== "number" || isNaN(progressIncrement)) {
      console.error(
        "Invalid progressIncrement:",
        progressIncrement,
        "for achievement:",
        achievementKey
      );
      return null;
    }
    if (
      typeof achievement.target_value !== "number" ||
      isNaN(achievement.target_value)
    ) {
      console.error(
        "Invalid target_value:",
        achievement.target_value,
        "for achievement:",
        achievementKey
      );
      return null;
    }

    const query = `
      INSERT INTO user_achievements (user_id, achievement_id, current_progress, is_completed)
      VALUES ($1::uuid, $2::uuid, $3::integer, ($3::integer) >= ($4::integer))
      ON CONFLICT (user_id, achievement_id)
      DO UPDATE SET
        current_progress = LEAST(user_achievements.current_progress + ($3::integer), ($4::integer)),
        is_completed = (user_achievements.current_progress + ($3::integer)) >= ($4::integer)
      RETURNING *;
    `;

    const { rows } = await db.query(query, [
      userId,
      achievement.id,
      progressIncrement,
      achievement.target_value,
    ]);

    return rows.length > 0 ? rows[0] : null;
  },

  /**
   * Set user achievement progress to a specific value
   */
  async setUserAchievementProgress(
    userId: string,
    achievementKey: string,
    progressValue: number
  ): Promise<UserAchievement | null> {
    // First get the achievement
    const achievement = await this.getAchievementByKey(achievementKey);
    if (!achievement) {
      console.warn(`Achievement not found: ${achievementKey}`);
      return null;
    }

    // Validate parameters
    if (!userId || typeof userId !== "string") {
      console.error("Invalid userId:", userId);
      return null;
    }
    if (typeof progressValue !== "number" || isNaN(progressValue)) {
      console.error(
        "Invalid progressValue:",
        progressValue,
        "for achievement:",
        achievementKey
      );
      return null;
    }
    if (
      typeof achievement.target_value !== "number" ||
      isNaN(achievement.target_value)
    ) {
      console.error(
        "Invalid target_value:",
        achievement.target_value,
        "for achievement:",
        achievementKey
      );
      return null;
    }

    const query = `
      INSERT INTO user_achievements (user_id, achievement_id, current_progress, is_completed)
      VALUES ($1::uuid, $2::uuid, $3::integer, ($3::integer) >= ($4::integer))
      ON CONFLICT (user_id, achievement_id)
      DO UPDATE SET
        current_progress = GREATEST(user_achievements.current_progress, ($3::integer)),
        is_completed = GREATEST(user_achievements.current_progress, ($3::integer)) >= ($4::integer)
      RETURNING *;
    `;

    const { rows } = await db.query(query, [
      userId,
      achievement.id,
      progressValue,
      achievement.target_value,
    ]);

    return rows.length > 0 ? rows[0] : null;
  },

  /**
   * Claim achievement rewards
   */
  async claimAchievement(
    userId: string,
    achievementId: string
  ): Promise<{
    success: boolean;
    userAchievement?: UserAchievement;
    rewards?: {
      gems: number;
      fate_coins: number;
      packs: number;
      card_fragments: number;
    };
  }> {
    // Check if achievement can be claimed
    const userAchievement = await this.getUserAchievement(
      userId,
      achievementId
    );

    console.log(
      `[CLAIM DEBUG] Achievement ${achievementId} for user ${userId}:`,
      {
        exists: !!userAchievement,
        isCompleted: userAchievement?.is_completed,
        isClaimed: userAchievement?.is_claimed,
        currentProgress: userAchievement?.current_progress,
      }
    );

    if (
      !userAchievement ||
      !userAchievement.is_completed ||
      userAchievement.is_claimed
    ) {
      console.log(`[CLAIM DEBUG] Cannot claim achievement ${achievementId}:`, {
        reason: !userAchievement
          ? "not_found"
          : !userAchievement.is_completed
          ? "not_completed"
          : userAchievement.is_claimed
          ? "already_claimed"
          : "unknown",
      });
      return { success: false };
    }

    // Get achievement details for rewards
    const achievement = await this.getAchievementById(achievementId);
    if (!achievement) {
      console.log(
        `[CLAIM DEBUG] Achievement ${achievementId} not found in achievements table`
      );
      return { success: false };
    }

    console.log(`[CLAIM DEBUG] Found achievement:`, {
      key: achievement.achievement_key,
      title: achievement.title,
      rewards: {
        gems: achievement.reward_gems,
        fate_coins: achievement.reward_fate_coins,
        packs: achievement.reward_packs,
        card_fragments: achievement.reward_card_fragments,
      },
    });

    // Mark as claimed
    const updateQuery = `
      UPDATE user_achievements
      SET is_claimed = true
      WHERE user_id = $1 AND achievement_id = $2
      RETURNING *;
    `;

    const { rows } = await db.query(updateQuery, [userId, achievementId]);

    if (rows.length === 0) {
      return { success: false };
    }

    return {
      success: true,
      userAchievement: rows[0],
      rewards: {
        gems: achievement.reward_gems,
        fate_coins: achievement.reward_fate_coins || 0,
        packs: achievement.reward_packs,
        card_fragments: achievement.reward_card_fragments || 0,
      },
    };
  },

  /**
   * Get achievement statistics for a user
   */
  async getUserAchievementStats(userId: string): Promise<{
    total_achievements: number;
    completed_achievements: number;
    claimed_achievements: number;
    completion_percentage: number;
    total_rewards_earned: {
      gems: number;
      fate_coins: number;
      packs: number;
      card_fragments: number;
    };
    achievements_by_category: Record<
      string,
      {
        total: number;
        completed: number;
        completion_percentage: number;
      }
    >;
    achievements_by_rarity: Record<
      string,
      {
        total: number;
        completed: number;
      }
    >;
  }> {
    const statsQuery = `
      WITH achievement_stats AS (
        SELECT 
          a.category,
          a.rarity,
          COUNT(*) as total_count,
          COUNT(ua.id) as user_count,
          SUM(CASE WHEN ua.is_completed = true THEN 1 ELSE 0 END) as completed_count,
          SUM(CASE WHEN ua.is_claimed = true THEN 1 ELSE 0 END) as claimed_count,
          SUM(CASE WHEN ua.is_claimed = true THEN a.reward_gems ELSE 0 END) as total_gems,
          SUM(CASE WHEN ua.is_claimed = true THEN COALESCE(a.reward_fate_coins, 0) ELSE 0 END) as total_fate_coins,
          SUM(CASE WHEN ua.is_claimed = true THEN a.reward_packs ELSE 0 END) as total_packs,
          SUM(CASE WHEN ua.is_claimed = true THEN COALESCE(a.reward_card_fragments, 0) ELSE 0 END) as total_card_fragments
        FROM achievements a
        LEFT JOIN user_achievements ua ON a.id = ua.achievement_id AND ua.user_id = $1
        WHERE a.is_active = true
        GROUP BY a.category, a.rarity
      ),
      totals AS (
        SELECT 
          SUM(total_count) as total_achievements,
          SUM(completed_count) as completed_achievements,
          SUM(claimed_count) as claimed_achievements,
          SUM(total_gems) as total_gems,
          SUM(total_fate_coins) as total_fate_coins,
          SUM(total_packs) as total_packs,
          SUM(total_card_fragments) as total_card_fragments
        FROM achievement_stats
      )
      SELECT 
        t.*,
        CASE 
          WHEN t.total_achievements > 0 
          THEN ROUND((t.completed_achievements::DECIMAL / t.total_achievements * 100), 2)
          ELSE 0 
        END as completion_percentage,
        json_object_agg(
          s.category,
          json_build_object(
            'total', s.total_count,
            'completed', s.completed_count,
            'completion_percentage', 
            CASE 
              WHEN s.total_count > 0 
              THEN ROUND((s.completed_count::DECIMAL / s.total_count * 100), 2)
              ELSE 0 
            END
          )
        ) FILTER (WHERE s.category IS NOT NULL) as category_stats,
        json_object_agg(
          s.rarity,
          json_build_object(
            'total', s.total_count,
            'completed', s.completed_count
          )
        ) FILTER (WHERE s.rarity IS NOT NULL) as rarity_stats
      FROM totals t
      CROSS JOIN achievement_stats s
      GROUP BY t.total_achievements, t.completed_achievements, t.claimed_achievements, 
               t.total_gems, t.total_fate_coins, t.total_packs, t.total_card_fragments, completion_percentage;
    `;

    const { rows } = await db.query(statsQuery, [userId]);

    if (rows.length === 0) {
      return {
        total_achievements: 0,
        completed_achievements: 0,
        claimed_achievements: 0,
        completion_percentage: 0,
        total_rewards_earned: {
          gems: 0,
          fate_coins: 0,
          packs: 0,
          card_fragments: 0,
        },
        achievements_by_category: {},
        achievements_by_rarity: {},
      };
    }

    const row = rows[0];
    return {
      total_achievements: parseInt(row.total_achievements) || 0,
      completed_achievements: parseInt(row.completed_achievements) || 0,
      claimed_achievements: parseInt(row.claimed_achievements) || 0,
      completion_percentage: parseFloat(row.completion_percentage) || 0,
      total_rewards_earned: {
        gems: parseInt(row.total_gems) || 0,
        fate_coins: parseInt(row.total_fate_coins) || 0,
        packs: parseInt(row.total_packs) || 0,
        card_fragments: parseInt(row.total_card_fragments) || 0,
      },
      achievements_by_category: row.category_stats || {},
      achievements_by_rarity: row.rarity_stats || {},
    };
  },

  /**
   * Get all tiers for a base achievement key
   */
  async getTieredAchievementsByBaseKey(
    baseKey: string
  ): Promise<Achievement[]> {
    const query = `
      SELECT * FROM achievements
      WHERE base_achievement_key = $1 AND is_active = true
      ORDER BY tier_level ASC;
    `;

    const { rows } = await db.query(query, [baseKey]);
    return rows;
  },

  /**
   * Get highest unlocked tier level for a user and base key
   */
  async getUnlockedTierLevel(userId: string, baseKey: string): Promise<number> {
    const query = `
      SELECT COALESCE(MAX(a.tier_level), 0) as max_tier
      FROM achievements a
      LEFT JOIN user_achievements ua ON a.id = ua.achievement_id AND ua.user_id = $1
      WHERE a.base_achievement_key = $2 
        AND a.is_active = true
        AND (a.tier_level IS NULL OR ua.is_completed = true);
    `;

    const { rows } = await db.query(query, [userId, baseKey]);
    return rows.length > 0 ? parseInt(rows[0].max_tier) || 0 : 0;
  },

  /**
   * Check if a specific tier achievement is unlocked for a user
   */
  async isTierUnlocked(
    userId: string,
    achievementId: string
  ): Promise<boolean> {
    const query = `
      SELECT 
        CASE 
          WHEN a.tier_level IS NULL THEN true
          WHEN a.tier_level = 1 THEN true
          ELSE EXISTS (
            SELECT 1 FROM user_achievements ua
            JOIN achievements prev ON prev.base_achievement_key = a.base_achievement_key 
              AND prev.tier_level = a.tier_level - 1
            WHERE ua.user_id = $1 
              AND ua.achievement_id = prev.id 
              AND ua.is_completed = true
          )
        END as is_unlocked
      FROM achievements a
      WHERE a.id = $2;
    `;

    const { rows } = await db.query(query, [userId, achievementId]);
    return rows.length > 0 ? rows[0].is_unlocked : false;
  },

  /**
   * Get achievements linked to a specific story
   */
  async getAchievementsByStoryId(storyId: string): Promise<Achievement[]> {
    const query = `
      SELECT * FROM achievements
      WHERE story_id = $1 AND is_active = true
      ORDER BY sort_order ASC, tier_level ASC;
    `;

    const { rows } = await db.query(query, [storyId]);
    return rows;
  },

  /**
   * Get user's story mode achievements with progress
   */
  async getStoryModeAchievements(
    userId: string,
    storyId?: string
  ): Promise<UserAchievementWithDetails[]> {
    let whereConditions = ["a.is_active = true"];
    const params = [userId];
    let paramIndex = 2;

    if (storyId) {
      whereConditions.push(`a.story_id = $${paramIndex}`);
      params.push(storyId);
      paramIndex++;
    } else {
      whereConditions.push("a.story_id IS NOT NULL");
    }

    const query = `
      SELECT 
        a.*,
        COALESCE(ua.id, null) as user_achievement_id,
        COALESCE(ua.current_progress, 0) as current_progress,
        COALESCE(ua.is_completed, false) as is_completed,
        ua.completed_at,
        ua.claimed_at,
        COALESCE(ua.is_claimed, false) as is_claimed,
        COALESCE(ua.created_at, null) as ua_created_at,
        COALESCE(ua.updated_at, null) as ua_updated_at,
        CASE 
          WHEN a.target_value > 0 
          THEN ROUND((COALESCE(ua.current_progress, 0)::DECIMAL / a.target_value * 100), 2)
          ELSE 0 
        END as progress_percentage,
        (COALESCE(ua.is_completed, false) = true AND COALESCE(ua.is_claimed, false) = false) as can_claim,
        CASE 
          WHEN a.tier_level IS NULL THEN true
          WHEN a.tier_level = 1 THEN true
          ELSE EXISTS (
            SELECT 1 FROM user_achievements ua_prev
            JOIN achievements prev ON prev.base_achievement_key = a.base_achievement_key 
              AND prev.tier_level = a.tier_level - 1
            WHERE ua_prev.user_id = $1 
              AND ua_prev.achievement_id = prev.id 
              AND ua_prev.is_completed = true
          )
        END as is_unlocked
      FROM achievements a
      LEFT JOIN user_achievements ua ON a.id = ua.achievement_id AND ua.user_id = $1
      WHERE ${whereConditions.join(" AND ")}
      ORDER BY a.sort_order ASC, a.tier_level ASC, a.created_at ASC;
    `;

    const { rows } = await db.query(query, params);

    return rows.map((row) => ({
      id: row.user_achievement_id,
      user_id: userId,
      achievement_id: row.id,
      current_progress: row.current_progress,
      is_completed: row.is_completed,
      completed_at: row.completed_at,
      claimed_at: row.claimed_at,
      is_claimed: row.is_claimed,
      created_at: row.ua_created_at,
      updated_at: row.ua_updated_at,
      achievement: {
        id: row.id,
        achievement_key: row.achievement_key,
        title: row.title,
        description: row.description,
        category: row.category,
        type: row.type,
        target_value: row.target_value,
        rarity: row.rarity,
        reward_gems: row.reward_gems,
        reward_fate_coins: row.reward_fate_coins || undefined,
        reward_packs: row.reward_packs,
        reward_card_fragments: row.reward_card_fragments || undefined,
        icon_url: row.icon_url,
        is_active: row.is_active,
        sort_order: row.sort_order,
        base_achievement_key: row.base_achievement_key,
        tier_level: row.tier_level,
        story_id: row.story_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
      progress_percentage: parseFloat(row.progress_percentage),
      can_claim: row.can_claim,
      is_unlocked: row.is_unlocked,
    }));
  },

  /**
   * Get recently completed achievements for a user
   */
  async getRecentlyCompletedAchievements(
    userId: string,
    limit: number = 10
  ): Promise<UserAchievementWithDetails[]> {
    const query = `
      SELECT 
        ua.*,
        a.id as achievement_db_id,
        a.achievement_key,
        a.title,
        a.description,
        a.category,
        a.type,
        a.target_value,
        a.rarity,
        a.reward_gems,
        a.reward_fate_coins,
        a.reward_packs,
        a.reward_card_fragments,
        a.icon_url,
        a.is_active,
        a.sort_order,
        a.base_achievement_key,
        a.tier_level,
        a.story_id,
        a.created_at as achievement_created_at,
        a.updated_at as achievement_updated_at,
        100.0 as progress_percentage,
        (ua.is_claimed = false) as can_claim,
        true as is_unlocked
      FROM user_achievements ua
      JOIN achievements a ON ua.achievement_id = a.id
      WHERE ua.user_id = $1 AND ua.is_completed = true
      ORDER BY ua.completed_at DESC
      LIMIT $2;
    `;

    const { rows } = await db.query(query, [userId, limit]);

    return rows.map((row) => ({
      id: row.id,
      user_id: row.user_id,
      achievement_id: row.achievement_id,
      current_progress: row.current_progress,
      is_completed: row.is_completed,
      completed_at: row.completed_at,
      claimed_at: row.claimed_at,
      is_claimed: row.is_claimed,
      created_at: row.created_at,
      updated_at: row.updated_at,
      achievement: {
        id: row.achievement_db_id,
        achievement_key: row.achievement_key,
        title: row.title,
        description: row.description,
        category: row.category,
        type: row.type,
        target_value: row.target_value,
        rarity: row.rarity,
        reward_gems: row.reward_gems,
        reward_fate_coins: row.reward_fate_coins || undefined,
        reward_packs: row.reward_packs,
        reward_card_fragments: row.reward_card_fragments || undefined,
        icon_url: row.icon_url,
        is_active: row.is_active,
        sort_order: row.sort_order,
        base_achievement_key: row.base_achievement_key,
        tier_level: row.tier_level,
        story_id: row.story_id,
        created_at: row.achievement_created_at,
        updated_at: row.achievement_updated_at,
      },
      progress_percentage: parseFloat(row.progress_percentage),
      can_claim: row.can_claim,
      is_unlocked: row.is_unlocked,
    }));
  },
};

export default AchievementModel;
