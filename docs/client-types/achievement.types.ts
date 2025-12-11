/**
 * Achievement API TypeScript Interfaces
 *
 * These interfaces define the structure of data returned from the achievement API endpoints.
 * Use these in your client application for type safety.
 */

// ============================================================================
// Base Types
// ============================================================================

export type AchievementCategory =
  | "gameplay"
  | "collection"
  | "social"
  | "progression"
  | "special"
  | "story_mode";

export type AchievementType =
  | "single" // One-time achievement
  | "progress" // Cumulative progress achievement
  | "milestone"; // Milestone-based achievement

export type AchievementRarity =
  | "common"
  | "uncommon"
  | "rare"
  | "epic"
  | "legendary"
  | "mythic";

// ============================================================================
// Core Interfaces
// ============================================================================

/**
 * Base Achievement definition
 */
export interface Achievement {
  id: string;
  achievement_key: string;
  title: string;
  description: string;
  category: AchievementCategory;
  type: AchievementType;
  target_value: number;
  rarity: AchievementRarity;
  reward_gems: number;
  reward_fate_coins?: number;
  reward_packs: number;
  reward_card_fragments?: number;
  icon_url?: string;
  is_active: boolean;
  sort_order: number;
  base_achievement_key?: string; // For tiered achievements
  tier_level?: number; // Tier number (1, 2, 3, etc.)
  story_id?: string; // For story-specific achievements
  created_at: string; // ISO date string
  updated_at: string; // ISO date string
}

/**
 * User's progress on a specific achievement
 */
export interface UserAchievement {
  id: string;
  user_id: string;
  achievement_id: string;
  current_progress: number;
  is_completed: boolean;
  completed_at?: string; // ISO date string
  claimed_at?: string; // ISO date string
  is_claimed: boolean;
  created_at: string; // ISO date string
  updated_at: string; // ISO date string
}

/**
 * User achievement with full details (most commonly used)
 */
export interface UserAchievementWithDetails extends UserAchievement {
  achievement: Achievement;
  progress_percentage: number; // 0-100
  can_claim: boolean; // true if completed but not claimed
  is_unlocked?: boolean; // true if achievement is available to progress
}

/**
 * Rewards structure
 */
export interface AchievementRewards {
  gems: number;
  fate_coins: number;
  packs: number;
  card_fragments: number;
}

/**
 * Updated user currencies after claiming
 */
export interface UpdatedCurrencies {
  gems: number;
  fate_coins: number;
  pack_count: number;
  card_fragments: number;
  total_xp: number;
}

/**
 * Achievement statistics
 */
export interface AchievementStats {
  total_achievements: number;
  completed_achievements: number;
  claimed_achievements: number;
  completion_percentage: number; // 0-100
  total_rewards_earned: AchievementRewards;
  achievements_by_category: {
    [category: string]: {
      total: number;
      completed: number;
      completion_percentage: number;
    };
  };
  achievements_by_rarity: {
    [rarity: string]: {
      total: number;
      completed: number;
    };
  };
}

/**
 * Achievement category info
 */
export interface AchievementCategoryInfo {
  category: string;
  total_count: number;
  display_name: string;
}

// ============================================================================
// API Request Parameters
// ============================================================================

/**
 * Query parameters for GET /api/achievements/me/progress
 */
export interface GetUserAchievementsParams {
  category?: AchievementCategory;
  completed?: boolean;
  unclaimed?: boolean;
  include_locked?: boolean;
}

/**
 * Query parameters for GET /api/achievements
 */
export interface GetAllAchievementsParams {
  include_inactive?: boolean;
}

/**
 * Query parameters for GET /api/achievements/me/recent
 */
export interface GetRecentAchievementsParams {
  limit?: number; // Default: 10, Max: 50
}

// ============================================================================
// API Response Interfaces
// ============================================================================

/**
 * Response from GET /api/achievements
 */
export interface GetAllAchievementsResponse {
  achievements: Achievement[];
}

/**
 * Response from GET /api/achievements/me/progress
 */
export interface GetUserAchievementsResponse {
  achievements: UserAchievementWithDetails[];
  stats: AchievementStats;
}

/**
 * Response from GET /api/achievements/me/stats
 */
export interface GetAchievementStatsResponse {
  stats: AchievementStats;
}

/**
 * Response from GET /api/achievements/me/recent
 */
export interface GetRecentAchievementsResponse {
  recent_achievements: UserAchievementWithDetails[];
}

/**
 * Response from GET /api/achievements/categories
 */
export interface GetAchievementCategoriesResponse {
  categories: AchievementCategoryInfo[];
}

/**
 * Response from GET /api/achievements/:achievementKey
 */
export interface GetAchievementDetailsResponse {
  achievement: Achievement;
}

/**
 * Response from POST /api/achievements/:achievementId/claim
 */
export interface ClaimAchievementResponse {
  claimedAchievements: UserAchievementWithDetails[];
  totalRewards: AchievementRewards;
  updatedCurrencies: UpdatedCurrencies;
}

// ============================================================================
// Error Response
// ============================================================================

/**
 * Standard error response structure
 */
export interface AchievementErrorResponse {
  success: false;
  error: {
    type: string;
    message: string;
    suggestion: string;
  };
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Achievement filter options
 */
export interface AchievementFilters {
  category?: AchievementCategory;
  rarity?: AchievementRarity;
  completed?: boolean;
  unclaimed?: boolean;
  claimable?: boolean; // For client-side filtering (can_claim === true)
}

/**
 * Achievement display state (for UI)
 */
export type AchievementDisplayState =
  | "locked" // Not unlocked yet (tier locked)
  | "available" // Unlocked but not completed
  | "in_progress" // Has some progress
  | "completed" // Completed but not claimed
  | "claimed"; // Completed and claimed

/**
 * Helper function to determine display state (client-side utility)
 */
export function getAchievementDisplayState(
  achievement: UserAchievementWithDetails
): AchievementDisplayState {
  if (achievement.is_unlocked === false) {
    return "locked";
  }
  if (achievement.is_claimed) {
    return "claimed";
  }
  if (achievement.is_completed) {
    return "completed";
  }
  if (achievement.current_progress > 0) {
    return "in_progress";
  }
  return "available";
}

/**
 * Helper function to check if achievement is claimable
 */
export function isAchievementClaimable(
  achievement: UserAchievementWithDetails
): boolean {
  return achievement.can_claim === true;
}

/**
 * Helper function to get progress display text
 */
export function getProgressText(
  achievement: UserAchievementWithDetails
): string {
  return `${achievement.current_progress} / ${achievement.achievement.target_value}`;
}

/**
 * Helper function to get total reward value (for sorting)
 */
export function getTotalRewardValue(achievement: Achievement): number {
  return (
    achievement.reward_gems +
    (achievement.reward_fate_coins || 0) * 10 +
    achievement.reward_packs * 100 +
    (achievement.reward_card_fragments || 0)
  );
}
