import { Request, Response } from "express";
import AchievementService from "../../services/achievement.service";
import AchievementModel from "../../models/achievement.model";

interface AuthenticatedRequest extends Request {
  user?: {
    user_id: string;
    username: string;
    email: string;
  };
}

/**
 * Get all achievements for the authenticated user
 */
export const getUserAchievements = async (
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
          suggestion: "Please log in to view your achievements",
        },
      });
    }

    const category = req.query.category as string;
    const completedOnly = req.query.completed === "true";
    const unclaimedOnly = req.query.unclaimed === "true";

    const result = await AchievementService.getUserAchievements(
      userId,
      category,
      completedOnly,
      unclaimedOnly
    );

    res.status(200).json(result);
  } catch (error) {
    console.error("Error fetching user achievements:", error);
    res.status(500).json({
      success: false,
      error: {
        type: "ACHIEVEMENTS_ERROR",
        message: "Failed to fetch achievements",
        suggestion: "Please try again later",
      },
    });
  }
};

/**
 * Get achievement categories with counts
 */
export const getAchievementCategories = async (req: Request, res: Response) => {
  try {
    const result = await AchievementService.getAchievementCategories();
    res.status(200).json(result);
  } catch (error) {
    console.error("Error fetching achievement categories:", error);
    res.status(500).json({
      success: false,
      error: {
        type: "CATEGORIES_ERROR",
        message: "Failed to fetch achievement categories",
        suggestion: "Please try again later",
      },
    });
  }
};

/**
 * Claim rewards for a completed achievement
 */
export const claimAchievementReward = async (
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
          suggestion: "Please log in to claim rewards",
        },
      });
    }

    const { achievementId } = req.params;

    if (!achievementId) {
      return res.status(400).json({
        success: false,
        error: {
          type: "VALIDATION_ERROR",
          message: "Achievement ID is required",
          suggestion: "Provide a valid achievement ID to claim rewards",
        },
      });
    }

    const result = await AchievementService.claimAchievementRewards(userId, [
      achievementId,
    ]);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.status(200).json(result);
  } catch (error) {
    console.error("Error claiming achievement reward:", error);
    res.status(500).json({
      success: false,
      error: {
        type: "CLAIM_ERROR",
        message: "Failed to claim achievement reward",
        suggestion: "Please try again later",
      },
    });
  }
};

/**
 * Get recently completed achievements for the user
 */
export const getRecentlyCompletedAchievements = async (
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
          suggestion: "Please log in to view recent achievements",
        },
      });
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

    const recentAchievements =
      await AchievementModel.getRecentlyCompletedAchievements(userId, limit);

    res.status(200).json({
      success: true,
      recent_achievements: recentAchievements,
    });
  } catch (error) {
    console.error("Error fetching recent achievements:", error);
    res.status(500).json({
      success: false,
      error: {
        type: "RECENT_ERROR",
        message: "Failed to fetch recent achievements",
        suggestion: "Please try again later",
      },
    });
  }
};

/**
 * Get achievement progress statistics for the user
 */
export const getAchievementStats = async (
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
          suggestion: "Please log in to view achievement statistics",
        },
      });
    }

    const stats = await AchievementModel.getUserAchievementStats(userId);

    res.status(200).json({
      success: true,
      stats,
    });
  } catch (error) {
    console.error("Error fetching achievement stats:", error);
    res.status(500).json({
      success: false,
      error: {
        type: "STATS_ERROR",
        message: "Failed to fetch achievement statistics",
        suggestion: "Please try again later",
      },
    });
  }
};

/**
 * Get all available achievements (public endpoint)
 */
export const getAllAchievements = async (req: Request, res: Response) => {
  try {
    const includeInactive = req.query.include_inactive === "true";
    const achievements = await AchievementModel.getAllAchievements(
      includeInactive
    );

    res.status(200).json({
      success: true,
      achievements,
    });
  } catch (error) {
    console.error("Error fetching all achievements:", error);
    res.status(500).json({
      success: false,
      error: {
        type: "ALL_ACHIEVEMENTS_ERROR",
        message: "Failed to fetch achievements list",
        suggestion: "Please try again later",
      },
    });
  }
};

/**
 * Get specific achievement details
 */
export const getAchievementDetails = async (req: Request, res: Response) => {
  try {
    const { achievementKey } = req.params;

    if (!achievementKey) {
      return res.status(400).json({
        success: false,
        error: {
          type: "VALIDATION_ERROR",
          message: "Achievement key is required",
          suggestion: "Provide a valid achievement key",
        },
      });
    }

    const achievement = await AchievementModel.getAchievementByKey(
      achievementKey
    );

    if (!achievement) {
      return res.status(404).json({
        success: false,
        error: {
          type: "NOT_FOUND_ERROR",
          message: "Achievement not found",
          suggestion: "Check the achievement key and try again",
        },
      });
    }

    res.status(200).json({
      success: true,
      achievement,
    });
  } catch (error) {
    console.error("Error fetching achievement details:", error);
    res.status(500).json({
      success: false,
      error: {
        type: "DETAILS_ERROR",
        message: "Failed to fetch achievement details",
        suggestion: "Please try again later",
      },
    });
  }
};
