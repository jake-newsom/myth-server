/**
 * Frontend API contracts for achievements + borders + card backs.
 *
 * Source of truth: current runtime controllers/services in myth-server.
 * Base URL prefix for all routes below: /api
 *
 * Auth:
 * - User routes: Bearer JWT required where noted.
 * - Admin routes: Bearer JWT + admin role required.
 */

export type UUID = string;
export type ISODateString = string;

export interface ApiErrorResponse {
  success?: false;
  status?: "error";
  message?: string;
  error?: {
    type?: string;
    message?: string;
    suggestion?: string;
  };
}

// ============================================================================
// Shared domain models
// ============================================================================

export type AchievementKind = "standard" | "character";
export type AchievementCategory =
  | "gameplay"
  | "collection"
  | "social"
  | "progression"
  | "special"
  | "story_mode";
export type AchievementType = "single" | "progress" | "milestone";
export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

export interface CardBorder {
  border_id: UUID;
  name: string;
  description?: string | null;
  image_url: string;
  animation_key?: string | null;
  character_id?: UUID | null;
  set_id?: UUID | null;
  is_active: boolean;
  created_at?: ISODateString;
  updated_at?: ISODateString;
}

export interface OwnedBorder extends CardBorder {
  acquired_at: ISODateString;
}

export interface CharacterEligibleBorder extends CardBorder {
  is_owned: boolean;
  is_locked: boolean;
}

export interface EquippedBorder {
  border_id: UUID;
  name: string;
  image_url: string;
  animation_key?: string | null;
}

export interface CardBack {
  back_id: UUID;
  code_key: string;
  name: string;
  description?: string | null;
  image_url: string;
  animation_key?: string | null;
  is_active: boolean;
  created_at?: ISODateString;
  updated_at?: ISODateString;
}

export interface OwnedCardBack extends CardBack {
  acquired_at: ISODateString;
}

export interface EquippedCardBack {
  back_id: UUID;
  code_key: string;
  name: string;
  image_url: string;
  animation_key?: string | null;
}

export interface Achievement {
  id: UUID;
  achievement_key: string;
  title: string;
  description: string;
  achievement_kind: AchievementKind;
  character_id?: UUID | null;
  category: AchievementCategory;
  type: AchievementType;
  target_value: number;
  rarity: Rarity;
  reward_gems: number;
  reward_fate_coins?: number;
  reward_packs: number;
  reward_card_fragments?: number;
  reward_border_id?: UUID | null;
  icon_url?: string | null;
  is_active: boolean;
  sort_order: number;
  base_achievement_key?: string | null;
  tier_level?: number | null;
  story_id?: string | null;
  created_at: ISODateString;
  updated_at: ISODateString;
}

/**
 * Returned from list endpoints using LEFT JOIN user_achievements.
 * For not-yet-started achievements, `id/created_at/updated_at` can be null.
 */
export interface UserAchievementWithDetails {
  id: UUID | null;
  user_id: UUID;
  achievement_id: UUID;
  current_progress: number;
  is_completed: boolean;
  completed_at?: ISODateString | null;
  claimed_at?: ISODateString | null;
  is_claimed: boolean;
  created_at: ISODateString | null;
  updated_at: ISODateString | null;
  achievement: Achievement;
  progress_percentage: number;
  can_claim: boolean;
  is_unlocked?: boolean;
}

export interface AchievementStats {
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
}

// ============================================================================
// Reward grant projection used in achievement claim responses
// ============================================================================

export type GrantedRewardItem =
  | { type: "gems"; amount: number }
  | { type: "gold"; amount: number }
  | { type: "fate_coins"; amount: number }
  | { type: "card_fragments"; amount: number }
  | { type: "packs"; amount: number }
  | { type: "card"; card_variant_id: UUID }
  | { type: "border"; border_id: UUID };

export interface GrantedReward {
  item: GrantedRewardItem;
  user_card_instance_id?: UUID;
  newly_granted?: boolean;
}

// ============================================================================
// Route constants
// ============================================================================

export const ApiRoutes = {
  // Achievements (public + user)
  achievements: "/achievements",
  achievementCategories: "/achievements/categories",
  achievementByKey: (achievementKey: string) =>
    `/achievements/${achievementKey}`,
  achievementProgress: "/achievements/me/progress",
  achievementStats: "/achievements/me/stats",
  achievementRecent: "/achievements/me/recent",
  claimAchievement: (achievementId: UUID) => `/achievements/${achievementId}/claim`,

  // Character-scoped achievements (user)
  characterAchievements: (characterId: UUID) =>
    `/characters/${characterId}/achievements/me`,
  characterEligibleBorders: (characterId: UUID) =>
    `/characters/${characterId}/borders/eligible`,

  // Border catalog + ownership (user)
  borders: "/borders",
  ownedBorders: "/borders/owned",
  cardBacks: "/card-backs",
  ownedCardBacks: "/card-backs/owned",

  // Card border equip operations (user)
  setCardBorder: (userCardInstanceId: UUID) =>
    `/user-cards/${userCardInstanceId}/border`,
  equipBorderOnAllEmpty: "/user-cards/borders/equip-all",
  unequipAllBorders: "/user-cards/borders/unequip-all",

  // Admin achievements
  adminAchievements: "/admin/achievements",
  adminAchievementById: (achievementId: UUID) =>
    `/admin/achievements/${achievementId}`,

  // Admin borders
  adminBorders: "/admin/borders",
  adminBorderById: (borderId: UUID) => `/admin/borders/${borderId}`,
  adminGrantBorder: "/admin/borders/grant",
  adminRevokeBorder: "/admin/borders/revoke",
  adminCardBacks: "/admin/card-backs",
  adminCardBackById: (backId: UUID) => `/admin/card-backs/${backId}`,
  adminGrantCardBack: "/admin/card-backs/grant",
  adminRevokeCardBack: "/admin/card-backs/revoke",
} as const;

// ============================================================================
// User achievement endpoints
// ============================================================================

/**
 * GET /api/achievements
 * NOTE: returns only standard achievements (achievement_kind = "standard").
 */
export interface GetAllAchievementsQuery {
  include_inactive?: boolean;
}
export interface GetAllAchievementsResponse {
  achievements: Achievement[];
}

/**
 * GET /api/achievements/categories
 */
export interface GetAchievementCategoriesResponse {
  categories: Array<{
    category: string;
    total_count: number;
    display_name: string;
  }>;
}

/**
 * GET /api/achievements/:achievementKey
 */
export interface GetAchievementByKeyResponse {
  achievement: Achievement;
}

/**
 * GET /api/achievements/me/progress
 * NOTE: returns only standard achievements.
 */
export interface GetAchievementProgressQuery {
  category?: string;
  completed?: boolean;
  unclaimed?: boolean;
  include_locked?: boolean;
}
export interface GetAchievementProgressResponse {
  achievements: UserAchievementWithDetails[];
  stats: AchievementStats;
}

/**
 * GET /api/achievements/me/stats
 * NOTE: stats are over standard achievements only.
 */
export interface GetAchievementStatsResponse {
  stats: AchievementStats;
}

/**
 * GET /api/achievements/me/recent
 * NOTE: recent list contains standard achievements only.
 */
export interface GetRecentAchievementsQuery {
  limit?: number; // server caps at 50
}
export interface GetRecentAchievementsResponse {
  recent_achievements: UserAchievementWithDetails[];
}

/**
 * GET /api/characters/:characterId/achievements/me
 * Character-scoped achievement feed.
 */
export interface GetCharacterAchievementsQuery {
  include_locked?: boolean;
}
export interface GetCharacterAchievementsResponse {
  achievements: UserAchievementWithDetails[];
}

/**
 * GET /api/characters/:characterId/borders/eligible
 */
export interface GetCharacterEligibleBordersResponse {
  data: CharacterEligibleBorder[];
}

/**
 * POST /api/achievements/:achievementId/claim
 */
export interface ClaimAchievementRewardResponse {
  claimedAchievements: UserAchievementWithDetails[];
  totalRewards: {
    gems: number;
    fate_coins: number;
    packs: number;
    card_fragments: number;
    borders: number;
  };
  grantedItems?: GrantedReward[];
  updatedCurrencies?: {
    gems: number;
    fate_coins: number;
    pack_count: number;
    card_fragments: number;
    total_xp: number;
  };
}

// ============================================================================
// User border endpoints
// ============================================================================

/**
 * GET /api/borders
 */
export interface GetBordersResponse {
  data: CardBorder[];
}

/**
 * GET /api/borders/owned
 */
export interface GetOwnedBordersResponse {
  data: OwnedBorder[];
}

/**
 * PATCH /api/user-cards/:userCardInstanceId/border
 */
export interface SetUserCardBorderRequest {
  border_id: UUID | null;
}
export interface SetUserCardBorderResponse {
  user_card_instance_id: UUID;
  equipped_border_id: UUID | null;
}

/**
 * POST /api/user-cards/borders/equip-all
 */
export interface EquipBorderOnAllEmptyRequest {
  border_id: UUID;
}
export interface EquipBorderOnAllEmptyResponse {
  affected_count: number;
  border_id: UUID;
}

/**
 * POST /api/user-cards/borders/unequip-all
 */
export interface UnequipAllBordersResponse {
  affected_count: number;
}

// ============================================================================
// Admin achievement endpoints
// ============================================================================

export interface AdminAchievementCreateRequest {
  achievement_key: string;
  title: string;
  description: string;
  achievement_kind?: AchievementKind; // default "standard"
  character_id?: UUID | null;
  category: AchievementCategory;
  type: AchievementType;
  target_value: number;
  rarity: Rarity;
  reward_gems?: number;
  reward_fate_coins?: number;
  reward_packs?: number;
  reward_card_fragments?: number;
  reward_border_id?: UUID | null;
  icon_url?: string | null;
  is_active?: boolean;
  sort_order?: number;
  base_achievement_key?: string | null;
  tier_level?: number | null;
  story_id?: string | null;
}

export interface AdminAchievementUpdateRequest {
  achievement_key?: string;
  title?: string;
  description?: string;
  achievement_kind?: AchievementKind;
  character_id?: UUID | null;
  category?: AchievementCategory;
  type?: AchievementType;
  target_value?: number;
  rarity?: Rarity;
  reward_gems?: number;
  reward_fate_coins?: number;
  reward_packs?: number;
  reward_card_fragments?: number;
  reward_border_id?: UUID | null;
  icon_url?: string | null;
  is_active?: boolean;
  sort_order?: number;
  base_achievement_key?: string | null;
  tier_level?: number | null;
  story_id?: string | null;
}

export interface AdminAchievementResponse {
  data: Achievement;
}

// ============================================================================
// Admin border endpoints
// ============================================================================

export interface AdminCreateBorderRequest {
  name: string;
  image_url: string;
  description?: string | null;
  animation_key?: string | null;
  character_id?: UUID | null;
  set_id?: UUID | null;
}

export interface AdminUpdateBorderRequest {
  name?: string;
  image_url?: string;
  description?: string | null;
  animation_key?: string | null;
  character_id?: UUID | null;
  set_id?: UUID | null;
  is_active?: boolean;
}

export interface AdminBorderResponse {
  data: CardBorder;
}

export interface AdminBorderListResponse {
  data: CardBorder[];
}

export interface AdminGrantBorderRequest {
  userId: UUID;
  borderId: UUID;
}
export interface AdminGrantBorderResponse {
  status: "success";
  newly_granted: boolean;
}

export interface AdminRevokeBorderRequest {
  userId: UUID;
  borderId: UUID;
}
export interface AdminRevokeBorderResponse {
  status: "success";
  removed: boolean;
}

