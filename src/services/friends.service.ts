import FriendshipModel from "../models/friendship.model";
import UserModel from "../models/user.model";
import {
  Friendship,
  FriendshipWithUser,
  FriendRequestInput,
  FriendRequestResponse,
  FriendsListResponse,
  FriendRequestsResponse,
  UserSearchResponse,
} from "../types";

class FriendsService {
  /**
   * Send a friend request to another user
   */
  async sendFriendRequest(
    requesterId: string,
    input: FriendRequestInput
  ): Promise<FriendRequestResponse> {
    try {
      let addresseeId: string;

      // Find the addressee by username or ID
      if (input.addresseeUsername) {
        const addressee = await UserModel.findByUsername(
          input.addresseeUsername
        );
        if (!addressee) {
          return {
            success: false,
            message: "User not found",
            error: "USER_NOT_FOUND",
          };
        }
        addresseeId = addressee.user_id;
      } else if (input.addresseeId) {
        const addressee = await UserModel.findById(input.addresseeId);
        if (!addressee) {
          return {
            success: false,
            message: "User not found",
            error: "USER_NOT_FOUND",
          };
        }
        addresseeId = input.addresseeId;
      } else {
        return {
          success: false,
          message: "Either username or user ID must be provided",
          error: "INVALID_INPUT",
        };
      }

      // Check if user is trying to friend themselves
      if (requesterId === addresseeId) {
        return {
          success: false,
          message: "You cannot send a friend request to yourself",
          error: "SELF_FRIEND_REQUEST",
        };
      }

      // Check if friendship already exists
      const existingFriendship =
        await FriendshipModel.findFriendshipBetweenUsers(
          requesterId,
          addresseeId
        );

      if (existingFriendship) {
        if (existingFriendship.status === "accepted") {
          return {
            success: false,
            message: "You are already friends with this user",
            error: "ALREADY_FRIENDS",
          };
        } else if (existingFriendship.status === "pending") {
          return {
            success: false,
            message:
              "A friend request is already pending between you and this user",
            error: "REQUEST_PENDING",
          };
        } else if (existingFriendship.status === "blocked") {
          return {
            success: false,
            message: "Unable to send friend request",
            error: "BLOCKED",
          };
        }
      }

      // Send the friend request
      const friendship = await FriendshipModel.sendFriendRequest(
        requesterId,
        addresseeId
      );

      return {
        success: true,
        message: "Friend request sent successfully",
        friendship,
      };
    } catch (error) {
      console.error("Error sending friend request:", error);

      // Handle database constraint violations
      if ((error as any).message?.includes("Friendship already exists")) {
        return {
          success: false,
          message: "A friend request already exists between you and this user",
          error: "DUPLICATE_REQUEST",
        };
      }

      return {
        success: false,
        message: "Failed to send friend request",
        error: "INTERNAL_ERROR",
      };
    }
  }

  /**
   * Accept a friend request
   */
  async acceptFriendRequest(
    userId: string,
    friendshipId: string
  ): Promise<FriendRequestResponse> {
    try {
      // First, verify that the user is the addressee of this request
      const friendship = await FriendshipModel.findById(friendshipId);
      if (!friendship) {
        return {
          success: false,
          message: "Friend request not found",
          error: "REQUEST_NOT_FOUND",
        };
      }

      if (friendship.addressee_id !== userId) {
        return {
          success: false,
          message: "You can only accept friend requests sent to you",
          error: "UNAUTHORIZED",
        };
      }

      if (friendship.status !== "pending") {
        return {
          success: false,
          message: "This friend request is no longer pending",
          error: "REQUEST_NOT_PENDING",
        };
      }

      const updatedFriendship = await FriendshipModel.acceptFriendRequest(
        friendshipId
      );

      if (!updatedFriendship) {
        return {
          success: false,
          message: "Failed to accept friend request",
          error: "UPDATE_FAILED",
        };
      }

      return {
        success: true,
        message: "Friend request accepted successfully",
        friendship: updatedFriendship,
      };
    } catch (error) {
      console.error("Error accepting friend request:", error);
      return {
        success: false,
        message: "Failed to accept friend request",
        error: "INTERNAL_ERROR",
      };
    }
  }

  /**
   * Reject a friend request
   */
  async rejectFriendRequest(
    userId: string,
    friendshipId: string
  ): Promise<FriendRequestResponse> {
    try {
      // First, verify that the user is the addressee of this request
      const friendship = await FriendshipModel.findById(friendshipId);
      if (!friendship) {
        return {
          success: false,
          message: "Friend request not found",
          error: "REQUEST_NOT_FOUND",
        };
      }

      if (friendship.addressee_id !== userId) {
        return {
          success: false,
          message: "You can only reject friend requests sent to you",
          error: "UNAUTHORIZED",
        };
      }

      if (friendship.status !== "pending") {
        return {
          success: false,
          message: "This friend request is no longer pending",
          error: "REQUEST_NOT_PENDING",
        };
      }

      const updatedFriendship = await FriendshipModel.rejectFriendRequest(
        friendshipId
      );

      if (!updatedFriendship) {
        return {
          success: false,
          message: "Failed to reject friend request",
          error: "UPDATE_FAILED",
        };
      }

      return {
        success: true,
        message: "Friend request rejected successfully",
        friendship: updatedFriendship,
      };
    } catch (error) {
      console.error("Error rejecting friend request:", error);
      return {
        success: false,
        message: "Failed to reject friend request",
        error: "INTERNAL_ERROR",
      };
    }
  }

  /**
   * Remove a friend or cancel a friend request
   */
  async removeFriend(
    userId: string,
    friendshipId: string
  ): Promise<FriendRequestResponse> {
    try {
      // First, verify that the user is part of this friendship
      const friendship = await FriendshipModel.findById(friendshipId);
      if (!friendship) {
        return {
          success: false,
          message: "Friendship not found",
          error: "FRIENDSHIP_NOT_FOUND",
        };
      }

      if (
        friendship.requester_id !== userId &&
        friendship.addressee_id !== userId
      ) {
        return {
          success: false,
          message: "You can only manage your own friendships",
          error: "UNAUTHORIZED",
        };
      }

      const removed = await FriendshipModel.removeFriendship(friendshipId);

      if (!removed) {
        return {
          success: false,
          message: "Failed to remove friendship",
          error: "REMOVAL_FAILED",
        };
      }

      return {
        success: true,
        message:
          friendship.status === "accepted"
            ? "Friend removed successfully"
            : "Friend request cancelled successfully",
      };
    } catch (error) {
      console.error("Error removing friend:", error);
      return {
        success: false,
        message: "Failed to remove friendship",
        error: "INTERNAL_ERROR",
      };
    }
  }

  /**
   * Get user's friends list with statistics
   */
  async getFriendsList(userId: string): Promise<FriendsListResponse> {
    try {
      const [friends, stats] = await Promise.all([
        FriendshipModel.getFriends(userId),
        FriendshipModel.getFriendshipStats(userId),
      ]);

      return {
        success: true,
        friends,
        stats: {
          friends_count: stats.friends_count,
          pending_incoming: stats.pending_incoming,
          pending_outgoing: stats.pending_outgoing,
        },
      };
    } catch (error) {
      console.error("Error getting friends list:", error);
      return {
        success: true, // Return success with empty data rather than error
        friends: [],
        stats: {
          friends_count: 0,
          pending_incoming: 0,
          pending_outgoing: 0,
        },
      };
    }
  }

  /**
   * Get user's friend requests (incoming and outgoing)
   */
  async getFriendRequests(userId: string): Promise<FriendRequestsResponse> {
    try {
      const { incoming, outgoing } = await FriendshipModel.getAllFriendRequests(
        userId
      );

      return {
        success: true,
        incoming,
        outgoing,
        stats: {
          pending_incoming: incoming.length,
          pending_outgoing: outgoing.length,
        },
      };
    } catch (error) {
      console.error("Error getting friend requests:", error);
      return {
        success: true, // Return success with empty data rather than error
        incoming: [],
        outgoing: [],
        stats: {
          pending_incoming: 0,
          pending_outgoing: 0,
        },
      };
    }
  }

  /**
   * Search for users to add as friends
   */
  async searchUsers(
    searcherId: string,
    searchTerm: string,
    limit: number = 20
  ): Promise<UserSearchResponse> {
    try {
      if (!searchTerm.trim()) {
        return {
          success: true,
          users: [],
          query: searchTerm,
        };
      }

      const users = await FriendshipModel.searchUsersForFriending(
        searcherId,
        searchTerm.trim(),
        limit
      );

      return {
        success: true,
        users,
        query: searchTerm,
      };
    } catch (error) {
      console.error("Error searching users:", error);
      return {
        success: true, // Return success with empty data rather than error
        users: [],
        query: searchTerm,
      };
    }
  }

  /**
   * Check if two users are friends
   */
  async checkFriendshipStatus(
    userId1: string,
    userId2: string
  ): Promise<{
    areFriends: boolean;
    friendship: Friendship | null;
    status: string;
  }> {
    try {
      const friendship = await FriendshipModel.findFriendshipBetweenUsers(
        userId1,
        userId2
      );

      return {
        areFriends: friendship?.status === "accepted",
        friendship,
        status: friendship?.status || "none",
      };
    } catch (error) {
      console.error("Error checking friendship status:", error);
      return {
        areFriends: false,
        friendship: null,
        status: "error",
      };
    }
  }

  /**
   * Challenge a friend to a game
   */
  async challengeFriend(
    challengerId: string,
    friendId: string,
    deckId: string
  ): Promise<{
    success: boolean;
    gameId?: string;
    message: string;
    error?: string;
  }> {
    try {
      // First check if they are friends
      const areFriends = await FriendshipModel.areFriends(
        challengerId,
        friendId
      );
      if (!areFriends) {
        return {
          success: false,
          message: "You can only challenge friends to games",
          error: "NOT_FRIENDS",
        };
      }

      // Import here to avoid circular dependencies
      const DeckModel = require("../models/deck.model").default;
      const GameLogic = require("../game-engine/game.logic").GameLogic;
      const db = require("../config/db.config").default;

      // Validate challenger's deck
      const challengerDeck = await DeckModel.findByIdAndUserIdWithCards(
        deckId,
        challengerId
      );
      if (!challengerDeck || challengerDeck.cards.length < 10) {
        return {
          success: false,
          message: "Invalid or incomplete deck selected",
          error: "INVALID_DECK",
        };
      }

      // For friend challenges, we'll use the friend's default deck or a random valid deck
      // First, get a valid deck for the friend
      const friendDecks = await db.query(
        `SELECT d.deck_id 
         FROM decks d 
         JOIN deck_cards dc ON d.deck_id = dc.deck_id 
         WHERE d.user_id = $1 
         GROUP BY d.deck_id 
         HAVING COUNT(dc.user_card_instance_id) >= 10 
         LIMIT 1`,
        [friendId]
      );

      if (friendDecks.rows.length === 0) {
        return {
          success: false,
          message: "Friend doesn't have a valid deck for gameplay",
          error: "FRIEND_NO_DECK",
        };
      }

      const friendDeckId = friendDecks.rows[0].deck_id;
      const friendDeck = await DeckModel.findByIdAndUserIdWithCards(
        friendDeckId,
        friendId
      );

      // Extract card IDs for game initialization
      const challengerDeckCardIds = challengerDeck.cards.reduce(
        (acc: string[], card: any) => {
          for (let i = 0; i < card.quantity; i++) acc.push(card.card_id);
          return acc;
        },
        []
      );

      const friendDeckCardIds = friendDeck.cards.reduce(
        (acc: string[], card: any) => {
          for (let i = 0; i < card.quantity; i++) acc.push(card.card_id);
          return acc;
        },
        []
      );

      // Initialize game state
      const initialGameState = await GameLogic.initializeGame(
        challengerDeckCardIds,
        friendDeckCardIds,
        challengerId,
        friendId
      );

      // Challenger goes first
      initialGameState.current_player_id = challengerId;

      // Create the game in the database
      const gameQuery = `
        INSERT INTO "games" (player1_id, player2_id, player1_deck_id, player2_deck_id, game_mode, game_status, board_layout, game_state, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        RETURNING game_id;
      `;
      const gameValues = [
        challengerId,
        friendId,
        deckId,
        friendDeckId,
        "pvp",
        "active",
        "4x4",
        JSON.stringify(initialGameState),
      ];

      const gameResult = await db.query(gameQuery, gameValues);
      const newGameId = gameResult.rows[0].game_id;

      return {
        success: true,
        gameId: newGameId,
        message: "Friend challenge created successfully",
      };
    } catch (error) {
      console.error("Error challenging friend:", error);
      return {
        success: false,
        message: "Failed to create friend challenge",
        error: "INTERNAL_ERROR",
      };
    }
  }
}

export default new FriendsService();
