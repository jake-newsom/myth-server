/**
 * Achievement API Client Examples
 *
 * Example implementation showing how to use the achievement API with TypeScript.
 * Adapt this to your client's HTTP library (axios, fetch, etc.)
 */

import {
  Achievement,
  UserAchievementWithDetails,
  GetAllAchievementsResponse,
  GetUserAchievementsResponse,
  GetAchievementStatsResponse,
  GetRecentAchievementsResponse,
  GetAchievementCategoriesResponse,
  GetAchievementDetailsResponse,
  ClaimAchievementResponse,
  GetUserAchievementsParams,
  GetAllAchievementsParams,
  GetRecentAchievementsParams,
  AchievementErrorResponse,
} from "./achievement.types";

// ============================================================================
// Base Configuration
// ============================================================================

const API_BASE_URL = "https://your-api-server.com/api";

// Helper to get auth token (implement based on your auth system)
function getAuthToken(): string {
  // Example: return localStorage.getItem('auth_token') || '';
  return "your-jwt-token";
}

// Helper for authenticated requests
async function authenticatedFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getAuthToken()}`,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error: AchievementErrorResponse = await response.json();
    throw new Error(error.error.message);
  }

  return response.json();
}

// ============================================================================
// Achievement API Client
// ============================================================================

export class AchievementAPIClient {
  /**
   * Get all available achievements (public endpoint)
   */
  static async getAllAchievements(
    params?: GetAllAchievementsParams
  ): Promise<Achievement[]> {
    const queryParams = new URLSearchParams();
    if (params?.include_inactive) {
      queryParams.append("include_inactive", "true");
    }

    const queryString = queryParams.toString();
    const endpoint = `/achievements${queryString ? `?${queryString}` : ""}`;

    const response = await fetch(`${API_BASE_URL}${endpoint}`);
    const data: GetAllAchievementsResponse = await response.json();
    return data.achievements;
  }

  /**
   * Get user's achievement progress (authenticated)
   * This is the main endpoint you'll use to display achievements
   */
  static async getUserAchievements(
    params?: GetUserAchievementsParams
  ): Promise<GetUserAchievementsResponse> {
    const queryParams = new URLSearchParams();

    if (params?.category) {
      queryParams.append("category", params.category);
    }
    if (params?.completed !== undefined) {
      queryParams.append("completed", params.completed.toString());
    }
    if (params?.unclaimed !== undefined) {
      queryParams.append("unclaimed", params.unclaimed.toString());
    }
    if (params?.include_locked !== undefined) {
      queryParams.append("include_locked", params.include_locked.toString());
    }

    const queryString = queryParams.toString();
    const endpoint = `/achievements/me/progress${
      queryString ? `?${queryString}` : ""
    }`;

    return authenticatedFetch<GetUserAchievementsResponse>(endpoint);
  }

  /**
   * Get user's achievement statistics
   */
  static async getAchievementStats(): Promise<GetAchievementStatsResponse> {
    return authenticatedFetch<GetAchievementStatsResponse>(
      "/achievements/me/stats"
    );
  }

  /**
   * Get recently completed achievements
   */
  static async getRecentAchievements(
    params?: GetRecentAchievementsParams
  ): Promise<UserAchievementWithDetails[]> {
    const queryParams = new URLSearchParams();
    if (params?.limit) {
      queryParams.append("limit", params.limit.toString());
    }

    const queryString = queryParams.toString();
    const endpoint = `/achievements/me/recent${
      queryString ? `?${queryString}` : ""
    }`;

    const response = await authenticatedFetch<GetRecentAchievementsResponse>(
      endpoint
    );
    return response.recent_achievements;
  }

  /**
   * Get achievement categories
   */
  static async getAchievementCategories(): Promise<GetAchievementCategoriesResponse> {
    const response = await fetch(`${API_BASE_URL}/achievements/categories`);
    return response.json();
  }

  /**
   * Get specific achievement details by key
   */
  static async getAchievementDetails(
    achievementKey: string
  ): Promise<Achievement> {
    const response = await fetch(
      `${API_BASE_URL}/achievements/${achievementKey}`
    );
    const data: GetAchievementDetailsResponse = await response.json();
    return data.achievement;
  }

  /**
   * Claim rewards for a completed achievement
   */
  static async claimAchievement(
    achievementId: string
  ): Promise<ClaimAchievementResponse> {
    return authenticatedFetch<ClaimAchievementResponse>(
      `/achievements/${achievementId}/claim`,
      { method: "POST" }
    );
  }
}

// ============================================================================
// Usage Examples
// ============================================================================

/**
 * Example 1: Load all achievements on app start
 */
export async function loadAllAchievements() {
  try {
    const achievements = await AchievementAPIClient.getAllAchievements();
    console.log(`Loaded ${achievements.length} achievements`);
    return achievements;
  } catch (error) {
    console.error("Failed to load achievements:", error);
    throw error;
  }
}

/**
 * Example 2: Load user's achievement progress for main achievement screen
 */
export async function loadUserAchievementProgress() {
  try {
    const data = await AchievementAPIClient.getUserAchievements();

    console.log("Achievement Stats:", data.stats);
    console.log(`Total: ${data.stats.total_achievements}`);
    console.log(`Completed: ${data.stats.completed_achievements}`);
    console.log(`Completion: ${data.stats.completion_percentage}%`);

    return data;
  } catch (error) {
    console.error("Failed to load user achievements:", error);
    throw error;
  }
}

/**
 * Example 3: Get only unclaimed achievements (for notifications)
 */
export async function getUnclaimedAchievements() {
  try {
    const data = await AchievementAPIClient.getUserAchievements({
      unclaimed: true,
    });

    console.log(`You have ${data.achievements.length} unclaimed achievements!`);
    return data.achievements;
  } catch (error) {
    console.error("Failed to load unclaimed achievements:", error);
    throw error;
  }
}

/**
 * Example 4: Filter achievements by category
 */
export async function getGameplayAchievements() {
  try {
    const data = await AchievementAPIClient.getUserAchievements({
      category: "gameplay",
    });

    return data.achievements;
  } catch (error) {
    console.error("Failed to load gameplay achievements:", error);
    throw error;
  }
}

/**
 * Example 5: Claim an achievement
 */
export async function claimAchievementReward(achievementId: string) {
  try {
    const result = await AchievementAPIClient.claimAchievement(achievementId);

    console.log("Claimed achievements:", result.claimedAchievements);
    console.log("Total rewards:", result.totalRewards);
    console.log("Updated currencies:", result.updatedCurrencies);

    // Update your UI with new currency values
    return result;
  } catch (error) {
    console.error("Failed to claim achievement:", error);
    throw error;
  }
}

/**
 * Example 6: Show recent achievements after game completion
 */
export async function showRecentAchievements() {
  try {
    const recent = await AchievementAPIClient.getRecentAchievements({
      limit: 5,
    });

    if (recent.length > 0) {
      console.log("Recently completed achievements:");
      recent.forEach((achievement) => {
        console.log(`- ${achievement.achievement.title}`);
      });
    }

    return recent;
  } catch (error) {
    console.error("Failed to load recent achievements:", error);
    throw error;
  }
}

/**
 * Example 7: Get achievements that can be claimed right now
 */
export async function getClaimableAchievements() {
  try {
    const data = await AchievementAPIClient.getUserAchievements();

    // Filter for achievements that can be claimed
    const claimable = data.achievements.filter((a) => a.can_claim);

    console.log(`${claimable.length} achievements ready to claim`);
    return claimable;
  } catch (error) {
    console.error("Failed to get claimable achievements:", error);
    throw error;
  }
}

/**
 * Example 8: Claim all available achievements at once
 */
export async function claimAllAchievements() {
  try {
    const claimable = await getClaimableAchievements();

    // Claim each achievement
    const results = await Promise.all(
      claimable.map((achievement) =>
        AchievementAPIClient.claimAchievement(achievement.achievement_id)
      )
    );

    // Sum up total rewards
    const totalRewards = results.reduce(
      (acc, result) => ({
        gems: acc.gems + result.totalRewards.gems,
        fate_coins: acc.fate_coins + result.totalRewards.fate_coins,
        packs: acc.packs + result.totalRewards.packs,
        card_fragments: acc.card_fragments + result.totalRewards.card_fragments,
      }),
      { gems: 0, fate_coins: 0, packs: 0, card_fragments: 0 }
    );

    console.log("Total rewards claimed:", totalRewards);
    return results;
  } catch (error) {
    console.error("Failed to claim all achievements:", error);
    throw error;
  }
}

// ============================================================================
// React Hook Example (if using React)
// ============================================================================

/**
 * Example React hook for managing achievements
 */
export function useAchievements() {
  // Using React hooks (adjust for your framework)
  const [achievements, setAchievements] = React.useState<
    UserAchievementWithDetails[]
  >([]);
  const [stats, setStats] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<Error | null>(null);

  const loadAchievements = React.useCallback(async () => {
    try {
      setLoading(true);
      const data = await AchievementAPIClient.getUserAchievements();
      setAchievements(data.achievements);
      setStats(data.stats);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  const claimAchievement = React.useCallback(
    async (achievementId: string) => {
      try {
        const result = await AchievementAPIClient.claimAchievement(
          achievementId
        );
        // Reload achievements to get updated state
        await loadAchievements();
        return result;
      } catch (err) {
        setError(err as Error);
        throw err;
      }
    },
    [loadAchievements]
  );

  React.useEffect(() => {
    loadAchievements();
  }, [loadAchievements]);

  return {
    achievements,
    stats,
    loading,
    error,
    reload: loadAchievements,
    claimAchievement,
  };
}

// ============================================================================
// Axios Example (if using axios instead of fetch)
// ============================================================================

/*
import axios from 'axios';

const api = axios.create({
  baseURL: API_BASE_URL,
});

// Add auth interceptor
api.interceptors.request.use((config) => {
  const token = getAuthToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export class AchievementAPIClientAxios {
  static async getUserAchievements(params?: GetUserAchievementsParams) {
    const { data } = await api.get<GetUserAchievementsResponse>(
      '/achievements/me/progress',
      { params }
    );
    return data;
  }

  static async claimAchievement(achievementId: string) {
    const { data } = await api.post<ClaimAchievementResponse>(
      `/achievements/${achievementId}/claim`
    );
    return data;
  }
  
  // ... other methods
}
*/
