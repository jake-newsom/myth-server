import { Request, Response } from "express";
import FriendsService from "../../services/friends.service";

// Define the authenticated request type locally
interface AuthenticatedRequest extends Request {
  user?: any;
}

/**
 * Challenge a friend to a game
 * POST /api/friends/challenge/:friendId
 * Body: { deckId: string }
 */
export const challengeFriend = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const challengerId = req.user!.user_id;
    const { friendId } = req.params;
    const { deckId } = req.body;

    if (!friendId) {
      res.status(400).json({
        success: false,
        error: {
          type: "VALIDATION_ERROR",
          message: "Friend ID is required",
          details: {
            field: "friendId",
            issue: "Missing friend ID in URL parameters",
          },
          suggestion: "Provide a valid friend ID in the URL",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
      return;
    }

    if (!deckId) {
      res.status(400).json({
        success: false,
        error: {
          type: "VALIDATION_ERROR",
          message: "Deck ID is required",
          details: {
            field: "deckId",
            issue: "Missing deck ID in request body",
          },
          suggestion: "Provide a valid deck ID to challenge with",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
      return;
    }

    const result = await FriendsService.challengeFriend(
      challengerId,
      friendId,
      deckId
    );

    if (result.success) {
      res.status(201).json(result);
    } else {
      let status = 400;
      if (result.error === "NOT_FRIENDS") {
        status = 403;
      } else if (result.error === "FRIEND_NO_DECK") {
        status = 422;
      } else if (result.error === "INVALID_DECK") {
        status = 400;
      }

      res.status(status).json({
        success: false,
        error: {
          type: result.error || "UNKNOWN_ERROR",
          message: result.message,
          details: "Friend challenge could not be created",
          suggestion: "Please verify you are friends and have valid decks",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  } catch (error) {
    console.error("Error in challengeFriend:", error);
    res.status(500).json({
      success: false,
      error: {
        type: "INTERNAL_ERROR",
        message: "Failed to challenge friend",
        details:
          "An unexpected error occurred while creating the friend challenge",
        suggestion: "Please try again later",
        timestamp: new Date().toISOString(),
        path: req.path,
      },
    });
  }
};
