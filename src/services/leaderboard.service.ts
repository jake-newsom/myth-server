import LeaderboardModel from "../models/leaderboard.model";
import {
  UserRanking,
  UserRankingWithUser,
  GameResult,
} from "../types/database.types";

interface LeaderboardResponse {
  success: boolean;
  leaderboard: UserRankingWithUser[];
  user_rank?: number;
  user_info?: UserRankingWithUser;
  pagination: {
    current_page: number;
    total_pages: number;
    total_players: number;
    per_page: number;
  };
  season_info: {
    current_season: string;
    season_start: Date;
    season_end: Date;
  };
}

interface RankingStatsResponse {
  success: boolean;
  stats: {
    total_players: number;
    total_games: number;
    average_rating: number;
    tier_distribution: Record<string, number>;
    top_players_by_tier: Record<string, UserRankingWithUser[]>;
  };
  season: string;
}

interface UserRankingResponse {
  success: boolean;
  user_ranking: UserRankingWithUser;
  rank_position: number;
  rank_progress: {
    current_tier: string;
    next_tier?: string;
    rating_needed_for_next_tier?: number;
    progress_percentage: number;
  };
  recent_games: any[];
  season: string;
}

const LeaderboardService = {
  /**
   * Get season dates for current season
   */
  getSeasonDates(season: string): { start: Date; end: Date } {
    const [year, quarter] = season.split("-");
    const yearNum = parseInt(year);
    const quarterNum = parseInt(quarter.replace("Q", ""));

    const start = new Date(yearNum, (quarterNum - 1) * 3, 1);
    const end = new Date(yearNum, quarterNum * 3, 0, 23, 59, 59);

    return { start, end };
  },

  /**
   * Get tier thresholds for ranking system
   */
  getTierThresholds(): Record<string, { min: number; max: number }> {
    return {
      Bronze: { min: 0, max: 999 },
      Silver: { min: 1000, max: 1299 },
      Gold: { min: 1300, max: 1599 },
      Platinum: { min: 1600, max: 1899 },
      Diamond: { min: 1900, max: 2199 },
      Master: { min: 2200, max: 2499 },
      Grandmaster: { min: 2500, max: 3000 },
    };
  },

  /**
   * Calculate rank progress for a user
   */
  calculateRankProgress(
    rating: number,
    currentTier: string
  ): {
    current_tier: string;
    next_tier?: string;
    rating_needed_for_next_tier?: number;
    progress_percentage: number;
  } {
    const tiers = [
      "Bronze",
      "Silver",
      "Gold",
      "Platinum",
      "Diamond",
      "Master",
      "Grandmaster",
    ];
    const thresholds = this.getTierThresholds();

    const currentTierIndex = tiers.indexOf(currentTier);
    const nextTier =
      currentTierIndex < tiers.length - 1
        ? tiers[currentTierIndex + 1]
        : undefined;

    const currentTierThreshold = thresholds[currentTier];
    const nextTierThreshold = nextTier ? thresholds[nextTier] : null;

    let progressPercentage = 0;
    let ratingNeededForNextTier: number | undefined;

    if (nextTierThreshold) {
      const currentTierRange =
        currentTierThreshold.max - currentTierThreshold.min;
      const userProgressInTier = rating - currentTierThreshold.min;
      progressPercentage = Math.round(
        (userProgressInTier / currentTierRange) * 100
      );
      ratingNeededForNextTier = nextTierThreshold.min - rating;
    } else {
      // Grandmaster tier
      progressPercentage = 100;
    }

    return {
      current_tier: currentTier,
      next_tier: nextTier,
      rating_needed_for_next_tier:
        ratingNeededForNextTier && ratingNeededForNextTier > 0
          ? ratingNeededForNextTier
          : undefined,
      progress_percentage: Math.max(0, Math.min(100, progressPercentage)),
    };
  },

  /**
   * Get comprehensive leaderboard with user context
   */
  async getLeaderboard(
    userId?: string,
    season?: string,
    page: number = 1,
    limit: number = 50
  ): Promise<LeaderboardResponse> {
    const currentSeason = season || LeaderboardModel.getCurrentSeason();
    const offset = (page - 1) * limit;

    // Get leaderboard data
    const leaderboard = await LeaderboardModel.getLeaderboard(
      currentSeason,
      limit,
      offset
    );

    // Get total players for pagination
    const stats = await LeaderboardModel.getLeaderboardStats(currentSeason);
    const totalPages = Math.ceil(stats.total_players / limit);

    // Get user-specific data if userId provided
    let userRank: number | undefined;
    let userInfo: UserRankingWithUser | undefined;

    if (userId) {
      const [rankResult, infoResult] = await Promise.all([
        LeaderboardModel.getUserRank(userId, currentSeason),
        LeaderboardModel.getUserRankingInfo(userId, currentSeason),
      ]);

      userRank = rankResult || undefined;
      userInfo = infoResult || undefined;
    }

    // Get season dates
    const seasonDates = this.getSeasonDates(currentSeason);

    return {
      success: true,
      leaderboard,
      user_rank: userRank || undefined,
      user_info: userInfo || undefined,
      pagination: {
        current_page: page,
        total_pages: totalPages,
        total_players: stats.total_players,
        per_page: limit,
      },
      season_info: {
        current_season: currentSeason,
        season_start: seasonDates.start,
        season_end: seasonDates.end,
      },
    };
  },

  /**
   * Get detailed ranking statistics
   */
  async getRankingStats(season?: string): Promise<RankingStatsResponse> {
    const currentSeason = season || LeaderboardModel.getCurrentSeason();

    const [stats, topPlayersByTier] = await Promise.all([
      LeaderboardModel.getLeaderboardStats(currentSeason),
      LeaderboardModel.getTopPlayersByTier(currentSeason),
    ]);

    return {
      success: true,
      stats: {
        ...stats,
        top_players_by_tier: topPlayersByTier,
      },
      season: currentSeason,
    };
  },

  /**
   * Get user's detailed ranking information
   */
  async getUserRanking(
    userId: string,
    season?: string
  ): Promise<UserRankingResponse> {
    const currentSeason = season || LeaderboardModel.getCurrentSeason();

    const [userRanking, rankPosition, recentGames] = await Promise.all([
      LeaderboardModel.getUserRankingInfo(userId, currentSeason),
      LeaderboardModel.getUserRank(userId, currentSeason),
      LeaderboardModel.getUserGameHistory(userId, 10, 0),
    ]);

    if (!userRanking) {
      throw new Error("User ranking not found");
    }

    const rankProgress = this.calculateRankProgress(
      userRanking.rating,
      userRanking.rank_tier
    );

    return {
      success: true,
      user_ranking: userRanking,
      rank_position: rankPosition || 0,
      rank_progress: rankProgress,
      recent_games: recentGames,
      season: currentSeason,
    };
  },

  /**
   * Process game completion and update rankings
   */
  async processGameCompletion(
    gameId: string,
    player1Id: string,
    player2Id: string,
    winnerId: string | null,
    gameMode: string,
    gameDurationSeconds: number,
    season?: string
  ): Promise<GameResult> {
    const currentSeason = season || LeaderboardModel.getCurrentSeason();

    // Record game result and update ratings
    // Note: Full rank position recalculation (updateAllRanks) has been removed
    // from the synchronous game completion flow for performance.
    // Ranks are calculated dynamically when viewing the leaderboard using
    // ROW_NUMBER() OVER (ORDER BY rating DESC) in the query.
    const gameResult = await LeaderboardModel.recordGameResult(
      gameId,
      player1Id,
      player2Id,
      winnerId,
      gameMode,
      gameDurationSeconds,
      currentSeason
    );

    return gameResult;
  },

  /**
   * Get user's rank history across seasons
   */
  async getUserRankHistory(
    userId: string,
    seasons?: string[]
  ): Promise<{
    success: boolean;
    rank_history: Array<{
      season: string;
      rating: number;
      peak_rating: number;
      rank_tier: string;
      wins: number;
      losses: number;
      draws: number;
      current_rank?: number;
      peak_rank?: number;
    }>;
  }> {
    // If no seasons specified, get last 4 seasons
    if (!seasons) {
      const currentSeason = LeaderboardModel.getCurrentSeason();
      const [year, quarter] = currentSeason.split("-");
      const yearNum = parseInt(year);
      const quarterNum = parseInt(quarter.replace("Q", ""));

      seasons = [];
      for (let i = 0; i < 4; i++) {
        let targetYear = yearNum;
        let targetQuarter = quarterNum - i;

        if (targetQuarter <= 0) {
          targetQuarter += 4;
          targetYear -= 1;
        }

        seasons.push(`${targetYear}-Q${targetQuarter}`);
      }
    }

    const rankHistory = [];

    for (const season of seasons) {
      const userRanking = await LeaderboardModel.getUserRankingInfo(
        userId,
        season
      );
      if (userRanking) {
        rankHistory.push({
          season,
          rating: userRanking.rating,
          peak_rating: userRanking.peak_rating,
          rank_tier: userRanking.rank_tier,
          wins: userRanking.wins,
          losses: userRanking.losses,
          draws: userRanking.draws,
          current_rank: userRanking.current_rank,
          peak_rank: userRanking.peak_rank,
        });
      }
    }

    return {
      success: true,
      rank_history: rankHistory,
    };
  },

  /**
   * Get leaderboard around a specific user (contextual leaderboard)
   */
  async getLeaderboardAroundUser(
    userId: string,
    season?: string,
    range: number = 10
  ): Promise<{
    success: boolean;
    leaderboard: UserRankingWithUser[];
    user_position: number;
    context_range: {
      start_rank: number;
      end_rank: number;
    };
  }> {
    const currentSeason = season || LeaderboardModel.getCurrentSeason();

    // Get user's current rank
    const userRank = await LeaderboardModel.getUserRank(userId, currentSeason);

    if (!userRank) {
      throw new Error("User not found in leaderboard");
    }

    // Calculate the range around the user
    const startRank = Math.max(1, userRank - range);
    const endRank = userRank + range;
    const limit = endRank - startRank + 1;
    const offset = startRank - 1;

    const leaderboard = await LeaderboardModel.getLeaderboard(
      currentSeason,
      limit,
      offset
    );

    return {
      success: true,
      leaderboard,
      user_position: userRank,
      context_range: {
        start_rank: startRank,
        end_rank: endRank,
      },
    };
  },

  /**
   * Initialize user ranking for new season
   */
  async initializeUserForSeason(
    userId: string,
    season?: string
  ): Promise<UserRanking> {
    const currentSeason = season || LeaderboardModel.getCurrentSeason();
    return await LeaderboardModel.getOrCreateUserRanking(userId, currentSeason);
  },
};

export default LeaderboardService;
