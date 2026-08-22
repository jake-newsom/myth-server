import LeaderboardModel from "../models/leaderboard.model";
import { RANKED_DRAFT_SEASON_PREFIX } from "../config/constants";
import { redisCache } from "./redis.cache.service";
import {
  resolveRank,
  IMMORTAL_FLOOR,
  rankProgressFor,
  rankDistribution,
  PVP_RANKS,
} from "../config/pvpRanks";
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
    /**
     * Distribution across the PvP rank ladder, strongest-first. Additive —
     * `tier_distribution` is unchanged for old clients.
     */
    rank_distribution?: Array<{ key: string; label: string; count: number }>;
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
  /**
   * PvP rank badge. Additive — old clients ignore it and keep rendering
   * `rank_tier`, which is unchanged.
   */
  pvp_rank?: {
    key: string;
    label: string;
    division: number;
    kind: string;
  };
  /** Progress toward the next RANK (not the legacy tier). Additive. */
  pvp_progress?: {
    current_rank_key: string;
    current_rank_label: string;
    next_rank_key: string | null;
    next_rank_label: string | null;
    rating_needed: number | null;
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
    // Ranked draft keys are `draft-YYYY-QN`; the calendar quarter is the tail.
    const quarterToken = season.startsWith(RANKED_DRAFT_SEASON_PREFIX)
      ? season.slice(RANKED_DRAFT_SEASON_PREFIX.length)
      : season;
    const [year, quarter] = quarterToken.split("-");
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

    // The standings page (rows + pagination) is identical for every viewer, so
    // we cache it per season/page/limit with a short TTL. The user-specific
    // fields (user_rank / user_info) are computed fresh below and never cached,
    // so this key stays user-independent and shareable across all viewers.
    const standingsCacheKey = `leaderboard:${currentSeason}:${page}:${limit}`;
    let standings = await redisCache.get<{
      leaderboard: UserRankingWithUser[];
      totalPages: number;
      totalPlayers: number;
    }>(standingsCacheKey);

    if (!standings) {
      const leaderboard = await LeaderboardModel.getLeaderboard(
        currentSeason,
        limit,
        offset
      );
      const stats = await LeaderboardModel.getLeaderboardStats(currentSeason);
      standings = {
        leaderboard,
        totalPages: Math.ceil(stats.total_players / limit),
        totalPlayers: stats.total_players,
      };
      // 5-minute TTL — standings can lag slightly behind the latest games.
      await redisCache.set(standingsCacheKey, standings, 300);
    }

    const { totalPages } = standings;
    // Size of the pool the proportional positional ranks slice into. Read once
    // per request rather than per row.
    const positionalPool = await LeaderboardModel.countPlayersAtOrAbove(
      IMMORTAL_FLOOR,
      currentSeason
    );
    // Decorate each row with its PvP rank badge. Additive: the existing
    // `rank_tier` field is untouched, so old clients are unaffected.
    const offsetBase = (page - 1) * limit;
    const leaderboard = standings.leaderboard.map((entry, index) => {
      const position = Number(entry.current_rank ?? offsetBase + index + 1);
      const resolved = resolveRank({
        rating: entry.rating,
        rankPosition: position,
        lastGameAt: entry.last_game_at,
        poolSize: positionalPool,
      });
      return {
        ...entry,
        pvp_rank: {
          key: resolved.rank.key,
          label: resolved.label,
          division: resolved.division,
          kind: resolved.rank.kind,
        },
      };
    });

    // Get user-specific data if userId provided
    let userRank: number | undefined;
    let userInfo: UserRankingWithUser | undefined;

    if (userId) {
      const infoResult = await LeaderboardModel.getUserRankingInfo(
        userId,
        currentSeason
      );
      userInfo = infoResult || undefined;
      userRank =
        infoResult?.current_rank !== undefined
          ? Number(infoResult.current_rank)
          : undefined;
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
        total_players: standings.totalPlayers,
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

    const [stats, topPlayersByTier, ratings] = await Promise.all([
      LeaderboardModel.getLeaderboardStats(currentSeason),
      LeaderboardModel.getTopPlayersByTier(currentSeason),
      LeaderboardModel.getRatingsForSeason(currentSeason),
    ]);

    return {
      success: true,
      stats: {
        ...stats,
        top_players_by_tier: topPlayersByTier,
        rank_distribution: rankDistribution(ratings),
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

    const [userRanking, recentGames] = await Promise.all([
      LeaderboardModel.getUserRankingInfo(userId, currentSeason),
      LeaderboardModel.getUserGameHistory(userId, 10, 0),
    ]);

    if (!userRanking) {
      throw new Error("User ranking not found");
    }

    const rankProgress = this.calculateRankProgress(
      userRanking.rating,
      userRanking.rank_tier
    );

    const rankPosition = Number(userRanking.current_rank || 0);
    // Only needed when the player could actually hold a positional rank, so a
    // rank-and-file lookup does not pay for the count.
    const positionalPool =
      userRanking.rating >= IMMORTAL_FLOOR
        ? await LeaderboardModel.countPlayersAtOrAbove(
            IMMORTAL_FLOOR,
            currentSeason
          )
        : null;
    const resolved = resolveRank({
      rating: userRanking.rating,
      rankPosition: rankPosition || null,
      lastGameAt: userRanking.last_game_at,
      poolSize: positionalPool,
    });

    return {
      success: true,
      user_ranking: userRanking,
      rank_position: rankPosition,
      rank_progress: rankProgress,
      pvp_rank: {
        key: resolved.rank.key,
        label: resolved.label,
        division: resolved.division,
        kind: resolved.rank.kind,
      },
      pvp_progress: rankProgressFor(userRanking.rating),
      recent_games: recentGames,
      season: currentSeason,
    };
  },

  /**
   * The rank ladder definition, for clients that want to render the full
   * progression (thresholds, names, divisions) without hardcoding it.
   */
  getRankLadder(): {
    success: boolean;
    ranks: Array<{
      key: string;
      label: string;
      kind: string;
      order: number;
      min_rating: number;
      /** null = unbounded (the top band). */
      max_rating: number | null;
      max_rank_position: number | null;
      divisions: number;
      description: string;
    }>;
  } {
    return {
      success: true,
      ranks: PVP_RANKS.map((r) => ({
        key: r.key,
        label: r.label,
        kind: r.kind,
        order: r.order,
        min_rating: r.minRating,
        // Infinity is not valid JSON — send null for the unbounded top band.
        max_rating: Number.isFinite(r.maxRating) ? r.maxRating : null,
        max_rank_position: r.maxRankPosition ?? null,
        divisions: r.divisions,
        description: r.description,
      })),
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
    // Ranked draft scores against its own ladder. `season` is an opaque
    // varchar in user_rankings, so a namespaced season string gives the draft
    // ladder fully independent rating/rank/W-L with no schema change. An
    // explicit season argument still wins.
    const currentSeason =
      season || LeaderboardModel.getSeasonForGameMode(gameMode);

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

    // Fetch all seasons in one query (was an N+1 over getUserRankingInfo).
    const rankings = await LeaderboardModel.getUserRankingInfoForSeasons(
      userId,
      seasons
    );
    const rankingBySeason = new Map(rankings.map((r) => [r.season, r]));

    const rankHistory = [];
    for (const season of seasons) {
      const userRanking = rankingBySeason.get(season);
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

    // Get user's current rank from ranking info query (single rank computation path)
    const userInfo = await LeaderboardModel.getUserRankingInfo(
      userId,
      currentSeason
    );
    const userRank = userInfo?.current_rank
      ? Number(userInfo.current_rank)
      : null;

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
