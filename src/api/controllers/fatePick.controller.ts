import { Request, Response } from "express";
import FatePickService from "../../services/fatePick.service";

interface AuthenticatedRequest extends Request {
  user?: {
    user_id: string;
    username: string;
    email: string;
  };
}

/**
 * Get available wonder picks for the authenticated user
 */
export const getAvailableFatePicks = async (
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
          suggestion: "Please log in to view wonder picks",
        },
      });
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);

    const result = await FatePickService.getAvailableFatePicks(
      userId,
      page,
      limit
    );

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: {
          type: "fate_pick_ERROR",
          message: result.error,
          suggestion: "Try refreshing or check your network connection",
        },
      });
    }

    res.json({
      fate_picks: result.fatePicks,
      pagination: result.pagination,
      user_wonder_coins: result.userFateCoins,
    });
  } catch (error) {
    console.error("Error in getAvailableFatePicks:", error);
    res.status(500).json({
      success: false,
      error: {
        type: "SERVER_ERROR",
        message: "Failed to retrieve wonder picks",
        suggestion: "Please try again later",
      },
    });
  }
};

/**
 * Get specific wonder pick details
 */
export const getFatePickDetails = async (
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
          suggestion: "Please log in to view wonder pick details",
        },
      });
    }

    const { fatePickId } = req.params;
    if (!fatePickId) {
      return res.status(400).json({
        success: false,
        error: {
          type: "VALIDATION_ERROR",
          message: "Wonder pick ID is required",
          suggestion: "Please provide a valid wonder pick ID",
        },
      });
    }

    const result = await FatePickService.getFatePickDetails(fatePickId, userId);

    if (!result.success) {
      const statusCode = result.error === "Wonder pick not found" ? 404 : 400;
      return res.status(statusCode).json({
        success: false,
        error: {
          type: statusCode === 404 ? "NOT_FOUND" : "fate_pick_ERROR",
          message: result.error,
          suggestion:
            statusCode === 404
              ? "Please check the wonder pick ID and try again"
              : "Try refreshing or check your network connection",
        },
      });
    }

    res.json({
      fate_pick: result.fatePick,
      user_participation: result.userParticipation,
    });
  } catch (error) {
    console.error("Error in getFatePickDetails:", error);
    res.status(500).json({
      success: false,
      error: {
        type: "SERVER_ERROR",
        message: "Failed to retrieve wonder pick details",
        suggestion: "Please try again later",
      },
    });
  }
};

/**
 * Participate in a wonder pick (spend wonder coins and shuffle)
 */
export const participateInFatePick = async (
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
          suggestion: "Please log in to participate in wonder picks",
        },
      });
    }

    const { fatePickId } = req.params;
    if (!fatePickId) {
      return res.status(400).json({
        success: false,
        error: {
          type: "VALIDATION_ERROR",
          message: "Wonder pick ID is required",
          suggestion: "Please provide a valid wonder pick ID",
        },
      });
    }

    const result = await FatePickService.participateInFatePick(
      fatePickId,
      userId
    );

    if (!result.success) {
      let statusCode = 400;
      let errorType = "fate_pick_ERROR";

      if (result.error?.includes("not found")) {
        statusCode = 404;
        errorType = "NOT_FOUND";
      } else if (result.error?.includes("Insufficient wonder coins")) {
        statusCode = 400;
        errorType = "INSUFFICIENT_FUNDS";
      }

      return res.status(statusCode).json({
        success: false,
        error: {
          type: errorType,
          message: result.error,
          suggestion:
            errorType === "INSUFFICIENT_FUNDS"
              ? "You need more wonder coins to participate in this wonder pick"
              : "Please check the wonder pick status and try again",
        },
      });
    }

    res.json({
      participation: result.participation,
      updated_wonder_coins: result.updatedWonderCoins,
      message:
        "Successfully joined wonder pick! Select a card to reveal your prize.",
    });
  } catch (error) {
    console.error("Error in participateInFatePick:", error);
    res.status(500).json({
      success: false,
      error: {
        type: "SERVER_ERROR",
        message: "Failed to participate in wonder pick",
        suggestion: "Please try again later",
      },
    });
  }
};

/**
 * Select a card position to reveal the result
 */
export const selectCardPosition = async (
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
          suggestion: "Please log in to select a card",
        },
      });
    }

    const { fatePickId } = req.params;
    const { selectedPosition } = req.body;

    if (!fatePickId) {
      return res.status(400).json({
        success: false,
        error: {
          type: "VALIDATION_ERROR",
          message: "Wonder pick ID is required",
          suggestion: "Please provide a valid wonder pick ID",
        },
      });
    }

    if (
      typeof selectedPosition !== "number" ||
      selectedPosition < 0 ||
      selectedPosition > 4
    ) {
      return res.status(400).json({
        success: false,
        error: {
          type: "VALIDATION_ERROR",
          message: "Selected position must be a number between 0 and 4",
          suggestion: "Please select a valid card position (0-4)",
        },
      });
    }

    const result = await FatePickService.selectCardPosition(
      fatePickId,
      userId,
      selectedPosition
    );

    if (!result.success) {
      let statusCode = 400;
      let errorType = "fate_pick_ERROR";

      if (result.error?.includes("not participated")) {
        statusCode = 403;
        errorType = "PARTICIPATION_REQUIRED";
      } else if (result.error?.includes("expired")) {
        statusCode = 410;
        errorType = "EXPIRED";
      }

      return res.status(statusCode).json({
        success: false,
        error: {
          type: errorType,
          message: result.error,
          suggestion:
            errorType === "PARTICIPATION_REQUIRED"
              ? "You must participate in the wonder pick first"
              : "This wonder pick selection has expired",
        },
      });
    }

    res.json({
      participation: result.result?.participation,
      won_card: result.result?.wonCard,
      added_to_collection: result.result?.addedToCollection,
      message: `Congratulations! You won a ${result.result?.wonCard.rarity} ${result.result?.wonCard.name}!`,
    });
  } catch (error) {
    console.error("Error in selectCardPosition:", error);
    res.status(500).json({
      success: false,
      error: {
        type: "SERVER_ERROR",
        message: "Failed to select card position",
        suggestion: "Please try again later",
      },
    });
  }
};

/**
 * Get user's wonder pick participation history
 */
export const getUserParticipationHistory = async (
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
          suggestion: "Please log in to view your participation history",
        },
      });
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);

    const result = await FatePickService.getUserParticipationHistory(
      userId,
      page,
      limit
    );

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: {
          type: "fate_pick_ERROR",
          message: result.error,
          suggestion: "Try refreshing or check your network connection",
        },
      });
    }

    res.json({
      participations: result.participations,
      pagination: result.pagination,
      stats: result.stats,
    });
  } catch (error) {
    console.error("Error in getUserParticipationHistory:", error);
    res.status(500).json({
      success: false,
      error: {
        type: "SERVER_ERROR",
        message: "Failed to retrieve participation history",
        suggestion: "Please try again later",
      },
    });
  }
};

/**
 * Get wonder pick statistics (public endpoint)
 */
export const getFatePickStats = async (req: Request, res: Response) => {
  try {
    const result = await FatePickService.getFatePickStats();

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: {
          type: "fate_pick_ERROR",
          message: result.error,
          suggestion: "Try refreshing or check your network connection",
        },
      });
    }

    res.json({
      stats: result.stats,
    });
  } catch (error) {
    console.error("Error in getFatePickStats:", error);
    res.status(500).json({
      success: false,
      error: {
        type: "SERVER_ERROR",
        message: "Failed to retrieve wonder pick statistics",
        suggestion: "Please try again later",
      },
    });
  }
};

/**
 * Award wonder coins to a user (admin only)
 */
export const awardFateCoins = async (req: Request, res: Response) => {
  try {
    const { userId, amount, reason } = req.body;

    if (!userId || !amount) {
      return res.status(400).json({
        success: false,
        error: {
          type: "VALIDATION_ERROR",
          message: "User ID and amount are required",
          suggestion: "Please provide both userId and amount",
        },
      });
    }

    if (typeof amount !== "number" || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: {
          type: "VALIDATION_ERROR",
          message: "Amount must be a positive number",
          suggestion: "Please provide a valid positive amount",
        },
      });
    }

    const result = await FatePickService.awardFateCoins(userId, amount, reason);

    if (!result.success) {
      const statusCode = result.error === "User not found" ? 404 : 400;
      return res.status(statusCode).json({
        success: false,
        error: {
          type: statusCode === 404 ? "NOT_FOUND" : "fate_pick_ERROR",
          message: result.error,
          suggestion: "Please check the user ID and try again",
        },
      });
    }

    res.json({
      success: true,
      data: {
        user_id: userId,
        amount_awarded: amount,
        new_balance: result.newBalance,
        reason: reason || "Wonder coins awarded",
      },
    });
  } catch (error) {
    console.error("Error in awardFateCoins:", error);
    res.status(500).json({
      success: false,
      error: {
        type: "SERVER_ERROR",
        message: "Failed to award wonder coins",
        suggestion: "Please try again later",
      },
    });
  }
};
