import { Request, Response } from "express";
import { AuthenticatedRequest } from "../../types";
import SeasonService from "../../services/season.service";
import SeasonSoulsService from "../../services/seasonSouls.service";

export const getCurrentSeason = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const userId = req.user?.user_id;
    const data = await SeasonSoulsService.getCurrentSeasonSummary(userId);
    return res.status(200).json(data);
  } catch (error) {
    console.error("Error getting current season:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
};

export const getMyChoice = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      return res.status(401).json({
        status: "error",
        message: "Authentication required",
      });
    }

    const data = await SeasonSoulsService.getMyChoice(userId);
    return res.status(200).json(data);
  } catch (error) {
    console.error("Error getting mythology choice:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
};

export const chooseMythology = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      return res.status(401).json({
        status: "error",
        message: "Authentication required",
      });
    }

    const { set_id } = req.body;
    if (!set_id) {
      return res.status(400).json({
        status: "error",
        message: "set_id is required",
      });
    }

    try {
      const result = await SeasonSoulsService.chooseMythology(userId, set_id);
      return res.status(201).json({
        status: "success",
        message: "Mythology choice locked for the current season",
        data: result,
      });
    } catch (serviceError) {
      const errorMessage =
        serviceError instanceof Error ? serviceError.message : "Request failed";

      const statusCode =
        errorMessage.includes("already locked") ||
        errorMessage.includes("No active season")
          ? 409
          : errorMessage.includes("not available")
            ? 400
            : 500;

      return res.status(statusCode).json({
        status: "error",
        message: errorMessage,
      });
    }
  } catch (error) {
    console.error("Error locking mythology choice:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
};

export const getCurrentStandings = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    const data = await SeasonSoulsService.getCurrentStandings();
    return res.status(200).json(data);
  } catch (error) {
    console.error("Error getting season standings:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
};

export const getSetLeaderboard = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    const setId = req.query.set_id as string | undefined;
    if (!setId) {
      return res.status(400).json({
        status: "error",
        message: "set_id query parameter is required",
      });
    }

    const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
    const limit = Math.min(
      100,
      Math.max(1, parseInt((req.query.limit as string) || "50", 10))
    );

    try {
      const data = await SeasonSoulsService.getCurrentSetLeaderboard(
        setId,
        page,
        limit
      );
      return res.status(200).json(data);
    } catch (serviceError) {
      const message =
        serviceError instanceof Error ? serviceError.message : "Request failed";
      const statusCode = message.includes("not available") ? 400 : 500;
      return res.status(statusCode).json({
        status: "error",
        message,
      });
    }
  } catch (error) {
    console.error("Error getting season set leaderboard:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
};

export const getMyProgress = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      return res.status(401).json({
        status: "error",
        message: "Authentication required",
      });
    }

    const data = await SeasonSoulsService.getMySeasonProgress(userId);
    return res.status(200).json(data);
  } catch (error) {
    console.error("Error getting season progress:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
};

export const getMyRewardStatus = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      return res.status(401).json({
        status: "error",
        message: "Authentication required",
      });
    }

    const data = await SeasonSoulsService.getMyRewardStatus(userId);
    return res.status(200).json(data);
  } catch (error) {
    console.error("Error getting season reward status:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
};

export const ensureSeasonBuffer = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    await SeasonService.ensureSeasonBuffer(2);
    return res.status(200).json({
      status: "success",
      message: "Season buffer ensured",
    });
  } catch (error) {
    console.error("Error ensuring season buffer:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
};

export const listSeasons = async (req: Request, res: Response): Promise<Response> => {
  try {
    const limitRaw = req.query.limit as string | undefined;
    const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10), 1), 100) : 20;
    const seasons = await SeasonService.listSeasons(limit);
    return res.status(200).json({ seasons });
  } catch (error) {
    console.error("Error listing seasons:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
};

export const updateSeasonDates = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    const { seasonId } = req.params;
    const { start_at, end_at } = req.body;

    if (!seasonId) {
      return res.status(400).json({
        status: "error",
        message: "seasonId is required",
      });
    }

    if (!start_at || !end_at) {
      return res.status(400).json({
        status: "error",
        message: "start_at and end_at are required",
      });
    }

    const startAt = new Date(start_at);
    const endAt = new Date(end_at);
    const updated = await SeasonService.updateSeasonDates(seasonId, startAt, endAt);
    return res.status(200).json({
      status: "success",
      message: "Season dates updated",
      data: updated,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    const statusCode =
      message.includes("overlap") || message.includes("Invalid") ? 400 : 500;

    return res.status(statusCode).json({
      status: "error",
      message,
    });
  }
};
