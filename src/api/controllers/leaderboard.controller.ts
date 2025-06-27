import { Request, Response } from "express";
import LeaderboardService from "../../services/leaderboard.service";
import { AuthenticatedRequest } from "../../types";

/**
 * Get current leaderboard with optional user context
 */
export const getLeaderboard = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.user_id;
    const season = req.query.season as string;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100); // Max 100 per page

    const result = await LeaderboardService.getLeaderboard(
      userId,
      season,
      page,
      limit
    );

    res.status(200).json(result);
  } catch (error) {
    console.error("Error fetching leaderboard:", error);
    res.status(500).json({
      success: false,
      error: {
        type: "LEADERBOARD_ERROR",
        message: "Failed to fetch leaderboard",
        suggestion:
          "Please try again later or contact support if the issue persists",
      },
    });
  }
};

/**
 * Get leaderboard statistics and tier information
 */
export const getLeaderboardStats = async (req: Request, res: Response) => {
  try {
    const season = req.query.season as string;

    const result = await LeaderboardService.getRankingStats(season);

    res.status(200).json(result);
  } catch (error) {
    console.error("Error fetching leaderboard stats:", error);
    res.status(500).json({
      success: false,
      error: {
        type: "STATS_ERROR",
        message: "Failed to fetch leaderboard statistics",
        suggestion: "Please try again later",
      },
    });
  }
};

/**
 * Get user's detailed ranking information
 */
export const getUserRanking = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: {
          type: "AUTH_ERROR",
          message: "Authentication required",
          suggestion: "Please log in to view your ranking",
        },
      });
    }

    const season = req.query.season as string;

    const result = await LeaderboardService.getUserRanking(userId, season);

    res.status(200).json(result);
  } catch (error) {
    console.error("Error fetching user ranking:", error);

    if (error instanceof Error && error.message === "User ranking not found") {
      return res.status(404).json({
        success: false,
        error: {
          type: "RANKING_NOT_FOUND",
          message: "You haven't played any ranked games this season",
          suggestion: "Play some multiplayer games to get your initial ranking",
        },
      });
    }

    res.status(500).json({
      success: false,
      error: {
        type: "RANKING_ERROR",
        message: "Failed to fetch user ranking",
        suggestion: "Please try again later",
      },
    });
  }
};

/**
 * Get user's rank history across seasons
 */
export const getUserRankHistory = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: {
          type: "AUTH_ERROR",
          message: "Authentication required",
          suggestion: "Please log in to view your rank history",
        },
      });
    }

    // Parse seasons query parameter if provided
    let seasons: string[] | undefined;
    if (req.query.seasons) {
      try {
        seasons = Array.isArray(req.query.seasons)
          ? (req.query.seasons as string[])
          : [req.query.seasons as string];
      } catch (e) {
        return res.status(400).json({
          success: false,
          error: {
            type: "VALIDATION_ERROR",
            message: "Invalid seasons parameter",
            suggestion:
              "Provide seasons as an array of season identifiers (e.g., ['2024-Q1', '2024-Q2'])",
          },
        });
      }
    }

    const result = await LeaderboardService.getUserRankHistory(userId, seasons);

    res.status(200).json(result);
  } catch (error) {
    console.error("Error fetching rank history:", error);
    res.status(500).json({
      success: false,
      error: {
        type: "HISTORY_ERROR",
        message: "Failed to fetch rank history",
        suggestion: "Please try again later",
      },
    });
  }
};

/**
 * Get leaderboard around current user (contextual view)
 */
export const getLeaderboardAroundUser = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: {
          type: "AUTH_ERROR",
          message: "Authentication required",
          suggestion: "Please log in to view contextual leaderboard",
        },
      });
    }

    const season = req.query.season as string;
    const range = Math.min(parseInt(req.query.range as string) || 10, 25); // Max 25 players each side

    const result = await LeaderboardService.getLeaderboardAroundUser(
      userId,
      season,
      range
    );

    res.status(200).json(result);
  } catch (error) {
    console.error("Error fetching contextual leaderboard:", error);

    if (
      error instanceof Error &&
      error.message === "User not found in leaderboard"
    ) {
      return res.status(404).json({
        success: false,
        error: {
          type: "USER_NOT_RANKED",
          message: "You don't have a ranking for this season yet",
          suggestion:
            "Play some ranked multiplayer games to appear on the leaderboard",
        },
      });
    }

    res.status(500).json({
      success: false,
      error: {
        type: "CONTEXTUAL_LEADERBOARD_ERROR",
        message: "Failed to fetch leaderboard around your position",
        suggestion: "Please try again later",
      },
    });
  }
};

/**
 * Get specific user's public ranking (by username or user ID)
 */
export const getPublicUserRanking = async (req: Request, res: Response) => {
  try {
    const { identifier } = req.params; // username or user_id

    if (!identifier) {
      return res.status(400).json({
        success: false,
        error: {
          type: "VALIDATION_ERROR",
          message: "User identifier required",
          suggestion: "Provide a username or user ID to look up",
        },
      });
    }

    // For now, assume it's a user_id (we'd need UserModel integration for username lookup)
    const userId = identifier;
    const season = req.query.season as string;

    const result = await LeaderboardService.getUserRanking(userId, season);

    // Remove sensitive information for public view
    const publicResult = {
      ...result,
      user_ranking: {
        ...result.user_ranking,
        // Keep public fields only
        username: result.user_ranking.username,
        rating: result.user_ranking.rating,
        rank_tier: result.user_ranking.rank_tier,
        wins: result.user_ranking.wins,
        losses: result.user_ranking.losses,
        draws: result.user_ranking.draws,
        total_games: result.user_ranking.total_games,
        win_rate: result.user_ranking.win_rate,
        current_rank: result.user_ranking.current_rank,
        peak_rank: result.user_ranking.peak_rank,
        peak_rating: result.user_ranking.peak_rating,
      },
      recent_games: [], // Don't show recent games for privacy
    };

    res.status(200).json(publicResult);
  } catch (error) {
    console.error("Error fetching public user ranking:", error);

    if (error instanceof Error && error.message === "User ranking not found") {
      return res.status(404).json({
        success: false,
        error: {
          type: "USER_NOT_FOUND",
          message: "User not found or no ranking available",
          suggestion: "Check the username/ID or try a different season",
        },
      });
    }

    res.status(500).json({
      success: false,
      error: {
        type: "PUBLIC_RANKING_ERROR",
        message: "Failed to fetch user ranking",
        suggestion: "Please try again later",
      },
    });
  }
};

/**
 * Initialize user ranking for current season (mainly for new users)
 */
export const initializeUserRanking = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: {
          type: "AUTH_ERROR",
          message: "Authentication required",
          suggestion: "Please log in to initialize your ranking",
        },
      });
    }

    const season = req.body.season as string;

    const userRanking = await LeaderboardService.initializeUserForSeason(
      userId,
      season
    );

    res.status(200).json({
      success: true,
      message: "Ranking initialized successfully",
      user_ranking: userRanking,
    });
  } catch (error) {
    console.error("Error initializing user ranking:", error);
    res.status(500).json({
      success: false,
      error: {
        type: "INITIALIZATION_ERROR",
        message: "Failed to initialize ranking",
        suggestion: "Please try again later",
      },
    });
  }
};
