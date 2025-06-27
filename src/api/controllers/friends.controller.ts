import { Request, Response } from "express";
import FriendsService from "../../services/friends.service";

import { FriendRequestInput } from "../../types";

// Define the authenticated request type locally
interface AuthenticatedRequest extends Request {
  user?: any;
}

/**
 * Get user's friends list
 * GET /api/friends
 */
export const getFriends = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user!.user_id;
    const result = await FriendsService.getFriendsList(userId);

    // Remove success property and flatten response
    const { success, ...flattenedResult } = result;
    res.status(200).json(flattenedResult);
  } catch (error) {
    console.error("Error in getFriends:", error);
    res.status(500).json({
      success: false,
      error: {
        type: "INTERNAL_ERROR",
        message: "Failed to get friends list",
        details: "An unexpected error occurred while retrieving friends",
        suggestion: "Please try again later",
        timestamp: new Date().toISOString(),
        path: req.path,
      },
    });
  }
};

/**
 * Get user's friend requests (incoming and outgoing)
 * GET /api/friends/requests
 */
export const getFriendRequests = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user!.user_id;
    const result = await FriendsService.getFriendRequests(userId);

    // Remove success property and flatten response
    const { success, ...flattenedResult } = result;
    res.status(200).json(flattenedResult);
  } catch (error) {
    console.error("Error in getFriendRequests:", error);
    res.status(500).json({
      success: false,
      error: {
        type: "INTERNAL_ERROR",
        message: "Failed to get friend requests",
        details:
          "An unexpected error occurred while retrieving friend requests",
        suggestion: "Please try again later",
        timestamp: new Date().toISOString(),
        path: req.path,
      },
    });
  }
};

/**
 * Send a friend request
 * POST /api/friends/add
 * Body: { username?: string, userId?: string }
 */
export const sendFriendRequest = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const requesterId = req.user!.user_id;
    const { username, userId } = req.body;

    // Validate input
    if (!username && !userId) {
      res.status(400).json({
        success: false,
        error: {
          type: "VALIDATION_ERROR",
          message: "Either username or userId must be provided",
          details: {
            field: "username|userId",
            issue: "At least one identifier is required",
          },
          suggestion:
            "Provide either username or userId to send a friend request",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
      return;
    }

    const input: FriendRequestInput = {
      addresseeUsername: username,
      addresseeId: userId,
    };

    const result = await FriendsService.sendFriendRequest(requesterId, input);

    if (result.success) {
      // Remove success and message, return flattened result
      res.status(200).json({
        friendship: result.friendship,
      });
    } else {
      // Map error types to appropriate HTTP status codes
      let status = 400;
      if (result.error === "USER_NOT_FOUND") {
        status = 404;
      } else if (
        result.error === "ALREADY_FRIENDS" ||
        result.error === "REQUEST_PENDING"
      ) {
        status = 409;
      } else if (result.error === "BLOCKED") {
        status = 403;
      }

      res.status(status).json({
        success: false,
        error: {
          type: result.error || "UNKNOWN_ERROR",
          message: result.message,
          details: "Friend request could not be sent",
          suggestion: "Please check the username or try again later",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  } catch (error) {
    console.error("Error in sendFriendRequest:", error);
    res.status(500).json({
      success: false,
      error: {
        type: "INTERNAL_ERROR",
        message: "Failed to send friend request",
        details:
          "An unexpected error occurred while sending the friend request",
        suggestion: "Please try again later",
        timestamp: new Date().toISOString(),
        path: req.path,
      },
    });
  }
};

/**
 * Accept a friend request
 * POST /api/friends/accept/:friendshipId
 */
export const acceptFriendRequest = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user!.user_id;
    const { friendshipId } = req.params;

    if (!friendshipId) {
      res.status(400).json({
        success: false,
        error: {
          type: "VALIDATION_ERROR",
          message: "Friendship ID is required",
          details: {
            field: "friendshipId",
            issue: "Missing friendship ID in URL parameters",
          },
          suggestion: "Provide a valid friendship ID in the URL",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
      return;
    }

    const result = await FriendsService.acceptFriendRequest(
      userId,
      friendshipId
    );

    if (result.success) {
      // Remove success and message, return flattened result
      res.status(200).json({
        friendship: result.friendship,
      });
    } else {
      let status = 400;
      if (result.error === "REQUEST_NOT_FOUND") {
        status = 404;
      } else if (result.error === "UNAUTHORIZED") {
        status = 403;
      } else if (result.error === "REQUEST_NOT_PENDING") {
        status = 409;
      }

      res.status(status).json({
        success: false,
        error: {
          type: result.error || "UNKNOWN_ERROR",
          message: result.message,
          details: "Friend request could not be accepted",
          suggestion: "Please verify the request exists and try again",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  } catch (error) {
    console.error("Error in acceptFriendRequest:", error);
    res.status(500).json({
      success: false,
      error: {
        type: "INTERNAL_ERROR",
        message: "Failed to accept friend request",
        details:
          "An unexpected error occurred while accepting the friend request",
        suggestion: "Please try again later",
        timestamp: new Date().toISOString(),
        path: req.path,
      },
    });
  }
};

/**
 * Reject a friend request
 * POST /api/friends/reject/:friendshipId
 */
export const rejectFriendRequest = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user!.user_id;
    const { friendshipId } = req.params;

    if (!friendshipId) {
      res.status(400).json({
        success: false,
        error: {
          type: "VALIDATION_ERROR",
          message: "Friendship ID is required",
          details: {
            field: "friendshipId",
            issue: "Missing friendship ID in URL parameters",
          },
          suggestion: "Provide a valid friendship ID in the URL",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
      return;
    }

    const result = await FriendsService.rejectFriendRequest(
      userId,
      friendshipId
    );

    if (result.success) {
      // Remove success and message, return flattened result
      res.status(200).json({
        friendship: result.friendship,
      });
    } else {
      let status = 400;
      if (result.error === "REQUEST_NOT_FOUND") {
        status = 404;
      } else if (result.error === "UNAUTHORIZED") {
        status = 403;
      } else if (result.error === "REQUEST_NOT_PENDING") {
        status = 409;
      }

      res.status(status).json({
        success: false,
        error: {
          type: result.error || "UNKNOWN_ERROR",
          message: result.message,
          details: "Friend request could not be rejected",
          suggestion: "Please verify the request exists and try again",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  } catch (error) {
    console.error("Error in rejectFriendRequest:", error);
    res.status(500).json({
      success: false,
      error: {
        type: "INTERNAL_ERROR",
        message: "Failed to reject friend request",
        details:
          "An unexpected error occurred while rejecting the friend request",
        suggestion: "Please try again later",
        timestamp: new Date().toISOString(),
        path: req.path,
      },
    });
  }
};

/**
 * Remove a friend or cancel a friend request
 * DELETE /api/friends/:friendshipId
 */
export const removeFriend = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user!.user_id;
    const { friendshipId } = req.params;

    if (!friendshipId) {
      res.status(400).json({
        success: false,
        error: {
          type: "VALIDATION_ERROR",
          message: "Friendship ID is required",
          details: {
            field: "friendshipId",
            issue: "Missing friendship ID in URL parameters",
          },
          suggestion: "Provide a valid friendship ID in the URL",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
      return;
    }

    const result = await FriendsService.removeFriend(userId, friendshipId);

    if (result.success) {
      // Return empty object for successful deletion
      res.status(200).json({});
    } else {
      let status = 400;
      if (result.error === "FRIENDSHIP_NOT_FOUND") {
        status = 404;
      } else if (result.error === "UNAUTHORIZED") {
        status = 403;
      }

      res.status(status).json({
        success: false,
        error: {
          type: result.error || "UNKNOWN_ERROR",
          message: result.message,
          details: "Friendship could not be removed",
          suggestion: "Please verify the friendship exists and try again",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  } catch (error) {
    console.error("Error in removeFriend:", error);
    res.status(500).json({
      success: false,
      error: {
        type: "INTERNAL_ERROR",
        message: "Failed to remove friend",
        details: "An unexpected error occurred while removing the friend",
        suggestion: "Please try again later",
        timestamp: new Date().toISOString(),
        path: req.path,
      },
    });
  }
};

/**
 * Search for users to add as friends
 * GET /api/friends/search?q=searchTerm&limit=20
 */
export const searchUsers = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user!.user_id;
    const { q: searchTerm = "", limit = "20" } = req.query;

    const searchLimit = Math.min(parseInt(limit as string) || 20, 50); // Cap at 50

    const result = await FriendsService.searchUsers(
      userId,
      searchTerm as string,
      searchLimit
    );

    // Remove success property and flatten response
    const { success, ...flattenedResult } = result;
    res.status(200).json(flattenedResult);
  } catch (error) {
    console.error("Error in searchUsers:", error);
    res.status(500).json({
      success: false,
      error: {
        type: "INTERNAL_ERROR",
        message: "Failed to search users",
        details: "An unexpected error occurred while searching for users",
        suggestion: "Please try again later",
        timestamp: new Date().toISOString(),
        path: req.path,
      },
    });
  }
};

/**
 * Check friendship status between two users
 * GET /api/friends/status/:userId
 */
export const checkFriendshipStatus = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId1 = req.user!.user_id;
    const { userId: userId2 } = req.params;

    if (!userId2) {
      res.status(400).json({
        success: false,
        error: {
          type: "VALIDATION_ERROR",
          message: "User ID is required",
          details: {
            field: "userId",
            issue: "Missing user ID in URL parameters",
          },
          suggestion: "Provide a valid user ID in the URL",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
      return;
    }

    const result = await FriendsService.checkFriendshipStatus(userId1, userId2);

    // Return the result directly (already flattened)
    res.status(200).json(result);
  } catch (error) {
    console.error("Error in checkFriendshipStatus:", error);
    res.status(500).json({
      success: false,
      error: {
        type: "INTERNAL_ERROR",
        message: "Failed to check friendship status",
        details:
          "An unexpected error occurred while checking friendship status",
        suggestion: "Please try again later",
        timestamp: new Date().toISOString(),
        path: req.path,
      },
    });
  }
};
