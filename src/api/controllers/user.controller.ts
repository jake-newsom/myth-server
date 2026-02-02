// src/api/controllers/user.controller.ts
import UserModel from "../../models/user.model";
import CardModel from "../../models/card.model";
import DeckModel from "../../models/deck.model";
import GameService from "../../services/game.service";
import MonthlyLoginRewardsService from "../../services/monthlyLoginRewards.service";
import StarterService from "../../services/starter.service";
import SessionService from "../../services/session.service";
import db from "../../config/db.config";
import logger from "../../utils/logger";
import { Request, Response, NextFunction } from "express"; // Assuming Express types
import {
  UserCard,
  CardResponse,
  AuthenticatedRequest,
  TriggerMoment,
} from "../../types";
import { USER_LIMITS } from "../../config/constants";

// Helper function to transform CardResponse to UserCard
const transformToUserCard = (card: CardResponse): UserCard => ({
  user_card_instance_id: card.user_card_instance_id!,
  base_card_id: card.base_card_id,
  base_card_data: {
    card_id: card.base_card_id,
    name: card.name,
    tags: card.tags,
    rarity: card.rarity,
    image_url: card.image_url,
    base_power: card.base_power,
    set_id: card.set_id,
    special_ability: card.special_ability
      ? {
        id: card.special_ability.ability_id,
        name: card.special_ability.name,
        ability_id: card.special_ability.ability_id,
        description: card.special_ability.description,
        triggerMoments: card.special_ability.triggerMoments,
        parameters: card.special_ability.parameters,
      }
      : null,
  },
  level: card.level!,
  xp: card.xp!,
  power_enhancements: card.power_enhancements || {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
});

const UserController = {
  /**
   * Get current user's profile
   * @route GET /api/users/me
   * @param {AuthenticatedRequest} req - Express request object with authenticated user
   * @param {Response} res - Express response object
   * @param {NextFunction} next - Express next middleware function
   */
  async getMyProfile(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: { message: "User not authenticated." } });
        return;
      }
      const userProfile = await UserModel.findById(req.user.user_id); // Ensure UserModel.findById is updated if needed
      if (!userProfile) {
        res.status(404).json({ error: { message: "User not found." } });
        return;
      }
      res.status(200).json(userProfile);
    } catch (error) {
      next(error);
    }
  },

  /**
   * Get user's card instances
   * @route GET /api/users/me/cards
   * @param {AuthenticatedRequest} req - Express request object with authenticated user
   * @param {Response} res - Express response object
   * @param {NextFunction} next - Express next middleware function
   */
  async getMyCardInstances(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: { message: "User not authenticated." } });
        return;
      }
      const ownedCardInstances = await CardModel.findInstancesByUserId(
        req.user.user_id
      );

      // Transform CardResponse array to UserCard array
      const userCards: UserCard[] = ownedCardInstances.map(transformToUserCard);

      res.status(200).json(userCards);
    } catch (error) {
      next(error);
    }
  },

  /**
   * Get user's deck summaries
   * @route GET /api/users/me/decks
   * @param {AuthenticatedRequest} req - Express request object with authenticated user
   * @param {Response} res - Express response object
   * @param {NextFunction} next - Express next middleware function
   */
  async getMyDecks(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: { message: "User not authenticated." } });
        return;
      }
      const userDecks = await DeckModel.findAllByUserId(req.user.user_id); // This will return summaries

      // Transform cards arrays in each deck to UserCard arrays
      const decksWithUserCards = userDecks.map((deck) => ({
        ...deck,
        cards: deck.cards.map(transformToUserCard),
      }));

      res.status(200).json(decksWithUserCards);
    } catch (error) {
      next(error);
    }
  },

  /**
   * Get a specific deck with detailed card information
   * @route GET /api/users/me/decks/:deckId
   * @param {AuthenticatedRequest} req - Express request object with authenticated user
   * @param {Response} res - Express response object
   * @param {NextFunction} next - Express next middleware function
   */
  async getMyDeckById(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: { message: "User not authenticated." } });
        return;
      }
      const { deckId } = req.params;
      const deck = await DeckModel.findDeckWithInstanceDetails(
        deckId,
        req.user.user_id
      );
      if (!deck) {
        res.status(404).json({
          error: { message: "Deck not found or not owned by user." },
        });
        return;
      }

      // Transform cards array to UserCard type using helper function
      const userCards: UserCard[] = deck.cards.map(transformToUserCard);

      // Return deck with UserCard array
      res.status(200).json({
        ...deck,
        cards: userCards,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Get user's active games
   * @route GET /api/users/me/active-games
   * @param {AuthenticatedRequest} req - Express request object with authenticated user
   * @param {Response} res - Express response object
   * @param {NextFunction} next - Express next middleware function
   */
  async getMyActiveGames(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: { message: "User not authenticated." } });
        return;
      }

      // Check if user wants summary or full details
      const summary = req.query.summary === "true";

      let activeGames;
      if (summary) {
        activeGames = await GameService.getActiveGamesSummary(req.user.user_id);
      } else {
        activeGames = await GameService.getActiveGamesForUser(req.user.user_id);
      }

      res.status(200).json({
        success: true,
        active_games: activeGames,
        count: activeGames.length,
      });
    } catch (error) {
      console.error("Error fetching active games:", error);
      res.status(500).json({
        error: {
          message: "Failed to fetch active games",
          details: error instanceof Error ? error.message : "Unknown error",
        },
      });
    }
  },

  /**
   * Get monthly login status for current user
   * @route GET /api/users/me/monthly-login/status
   * @param {AuthenticatedRequest} req - Express request object with authenticated user
   * @param {Response} res - Express response object
   * @param {NextFunction} next - Express next middleware function
   */
  async getMonthlyLoginStatus(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: { message: "User not authenticated." } });
        return;
      }

      const status = await MonthlyLoginRewardsService.getMonthlyLoginStatus(
        req.user.user_id
      );

      res.status(200).json(status);
    } catch (error) {
      next(error);
    }
  },

  /**
   * Claim the next available monthly login reward
   * @route POST /api/users/me/monthly-login/claim
   * @param {AuthenticatedRequest} req - Express request object with authenticated user
   * @param {Response} res - Express response object
   * @param {NextFunction} next - Express next middleware function
   */
  async claimMonthlyReward(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: { message: "User not authenticated." } });
        return;
      }

      const result = await MonthlyLoginRewardsService.claimNextAvailableReward(
        req.user.user_id
      );

      res.status(200).json(result);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({
          error: { message: error.message },
        });
        return;
      }
      next(error);
    }
  },

  /**
   * Update user's account details (username, email, password)
   * @route PATCH /api/users/me
   * @param {AuthenticatedRequest} req - Express request object with authenticated user
   * @param {Response} res - Express response object
   * @param {NextFunction} next - Express next middleware function
   */
  async updateAccountDetails(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: { message: "User not authenticated." } });
        return;
      }

      const { username, email, password } = req.body;

      // At least one field must be provided for update
      if (!username && !email && !password) {
        res.status(400).json({
          error: {
            message:
              "At least one field (username, email, or password) must be provided for update.",
          },
        });
        return;
      }

      // Validate new password length if updating password
      if (password && password.length < 6) {
        res.status(400).json({
          error: {
            message: "New password must be at least 6 characters long.",
          },
        });
        return;
      }

      // Check if username is already taken by another user
      if (username) {
        if (username.length > USER_LIMITS.MAX_USERNAME_LENGTH) {
          res.status(400).json({
            error: {
              message: `Username must be ${USER_LIMITS.MAX_USERNAME_LENGTH} characters or less.`,
            },
          });
          return;
        }

        const existingUserByUsername = await UserModel.findByUsername(username);
        if (
          existingUserByUsername &&
          existingUserByUsername.user_id !== req.user.user_id
        ) {
          res.status(409).json({
            error: {
              message: "Username already taken.",
              code: "USERNAME_ALREADY_EXISTS",
            },
          });
          return;
        }
      }

      // Check if email is already taken by another user
      if (email) {
        // Basic email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          res.status(400).json({
            error: {
              message: "Invalid email format.",
            },
          });
          return;
        }

        const existingUserByEmail = await UserModel.findByEmail(email);
        if (
          existingUserByEmail &&
          existingUserByEmail.user_id !== req.user.user_id
        ) {
          res.status(409).json({
            error: {
              message: "Email already in use.",
              code: "EMAIL_ALREADY_EXISTS",
            },
          });
          return;
        }
      }

      // Update account details
      const updates: { username?: string; email?: string; password?: string } =
        {};
      if (username) updates.username = username;
      if (email) updates.email = email;
      if (password) updates.password = password;

      const updatedUser = await UserModel.updateAccountDetails(
        req.user.user_id,
        updates
      );

      if (!updatedUser) {
        res.status(500).json({
          error: {
            message: "Failed to update account details.",
          },
        });
        return;
      }

      res.status(200).json({
        message: "Account details updated successfully.",
        user: updatedUser,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Reset a user's account to starter state
   * @route POST /api/users/me/reset-account
   * @param {AuthenticatedRequest} req - Express request object with authenticated user
   * @param {Response} res - Express response object
   *
   * This endpoint can be used by:
   * - A user to reset their own account (no userId in body)
   * - An admin to reset any user's account (userId in body)
   *
   * WARNING: This is a destructive operation that:
   * - Deletes all user progress
   * - Resets all currencies to default
   * - Removes all cards, decks, and game history
   * - Grants fresh starter content
   */
  async resetAccount(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> {
    try {
      if (!req.user) {
        return res.status(401).json({
          status: "error",
          message: "User not authenticated.",
          timestamp: new Date().toISOString(),
        });
      }

      const isAdmin = req.user.role === "admin";
      const requestedUserId = req.body.userId;

      // Determine which user to reset
      let targetUserId: string;

      if (requestedUserId) {
        // If userId is provided, only admins can reset other users' accounts
        if (!isAdmin && requestedUserId !== req.user.user_id) {
          return res.status(403).json({
            status: "error",
            message: "You can only reset your own account.",
            timestamp: new Date().toISOString(),
          });
        }
        targetUserId = requestedUserId;
      } else {
        // No userId provided - reset the authenticated user's own account
        targetUserId = req.user.user_id;
      }

      // Verify target user exists
      const user = await UserModel.findById(targetUserId);
      if (!user) {
        return res.status(404).json({
          status: "error",
          message: "User not found",
          timestamp: new Date().toISOString(),
        });
      }

      const isResettingOwnAccount = targetUserId === req.user.user_id;

      logger.info("Resetting user account", {
        requesterId: req.user.user_id,
        requesterUsername: req.user.username,
        requesterIsAdmin: isAdmin,
        targetUserId: targetUserId,
        targetUsername: user.username,
        isResettingOwnAccount,
      });

      const client = await db.getClient();
      await client.query("BEGIN");

      try {
        // Delete all user-related data
        // Note: Many tables have CASCADE delete, but we explicitly delete for clarity

        // Delete user achievements
        await client.query(
          `DELETE FROM "user_achievements" WHERE user_id = $1`,
          [targetUserId]
        );

        // Delete XP transfers
        await client.query(`DELETE FROM "xp_transfers" WHERE user_id = $1`, [
          targetUserId,
        ]);

        // Delete XP pools
        await client.query(
          `DELETE FROM "user_card_xp_pools" WHERE user_id = $1`,
          [targetUserId]
        );

        // Delete pack opening history
        await client.query(
          `DELETE FROM "pack_opening_history" WHERE user_id = $1`,
          [targetUserId]
        );

        // Delete mail
        await client.query(`DELETE FROM "mail" WHERE user_id = $1`, [targetUserId]);

        // Delete fate pick participations
        await client.query(
          `DELETE FROM "fate_pick_participations" WHERE participant_id = $1`,
          [targetUserId]
        );

        // Delete fate picks created by user
        await client.query(
          `DELETE FROM "fate_picks" WHERE original_owner_id = $1`,
          [targetUserId]
        );

        // Delete friendships (both as requester and addressee)
        await client.query(
          `DELETE FROM "friendships" WHERE requester_id = $1 OR addressee_id = $1`,
          [targetUserId]
        );

        // Delete user rankings
        await client.query(`DELETE FROM "user_rankings" WHERE user_id = $1`, [
          targetUserId,
        ]);

        // Delete game results
        await client.query(
          `DELETE FROM "game_results" WHERE player1_id = $1 OR player2_id = $1`,
          [targetUserId]
        );

        // Delete games (decks will cascade)
        await client.query(
          `DELETE FROM "games" WHERE player1_id = $1 OR player2_id = $1`,
          [targetUserId]
        );

        // Delete decks (deck_cards will cascade)
        await client.query(`DELETE FROM "decks" WHERE user_id = $1`, [targetUserId]);

        // Delete user owned cards (user_card_power_ups will cascade)
        await client.query(
          `DELETE FROM "user_owned_cards" WHERE user_id = $1`,
          [targetUserId]
        );

        // Reset user currencies and tower progress to default values
        await client.query(
          `UPDATE "users" 
           SET gems = 0, 
               fate_coins = 2, 
               card_fragments = 0, 
               total_xp = 0, 
               pack_count = 0,
               in_game_currency = 0,
               tower_floor = 1
           WHERE user_id = $1`,
          [targetUserId]
        );

        await client.query("COMMIT");

        // Grant starter content (cards, deck, packs)
        await StarterService.grantStarterContent(targetUserId);

        // Fetch updated user to return
        const updatedUser = await UserModel.findById(targetUserId);

        logger.info("Account reset successfully", {
          requesterId: req.user.user_id,
          targetUserId: targetUserId,
          targetUsername: user.username,
        });

        return res.status(200).json({
          status: "success",
          message: "Account reset successfully",
          user: {
            user_id: updatedUser?.user_id,
            username: updatedUser?.username,
            gems: updatedUser?.gems,
            fate_coins: updatedUser?.fate_coins,
            card_fragments: updatedUser?.card_fragments,
            total_xp: updatedUser?.total_xp,
            pack_count: updatedUser?.pack_count,
          },
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error(
        "Reset account endpoint error",
        { userId: req.body.userId || req.user?.user_id },
        error instanceof Error ? error : new Error(String(error))
      );
      return res.status(500).json({
        status: "error",
        message: "Internal server error during account reset",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      });
    }
  },

  /**
   * Delete a user's account permanently
   * @route DELETE /api/users/me
   * @param {AuthenticatedRequest} req - Express request object with authenticated user
   * @param {Response} res - Express response object
   *
   * WARNING: This is a permanent, irreversible operation that:
   * - Deletes all user data including cards, decks, game history
   * - Removes the user account entirely
   * - Cannot be undone
   */
  async deleteAccount(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> {
    try {
      if (!req.user) {
        return res.status(401).json({
          error: { message: "User not authenticated." },
        });
      }

      const userId = req.user.user_id;

      logger.info("Deleting user account", {
        userId,
        username: req.user.username,
      });

      // Invalidate all sessions first
      await SessionService.invalidateAllUserSessions(userId);

      const client = await db.getClient();
      await client.query("BEGIN");

      try {
        // Delete all user-related data
        // Note: Many tables have CASCADE delete, but we explicitly delete for clarity

        // Delete user achievements
        await client.query(
          `DELETE FROM "user_achievements" WHERE user_id = $1`,
          [userId]
        );

        // Delete XP transfers
        await client.query(`DELETE FROM "xp_transfers" WHERE user_id = $1`, [
          userId,
        ]);

        // Delete XP pools
        await client.query(
          `DELETE FROM "user_card_xp_pools" WHERE user_id = $1`,
          [userId]
        );

        // Delete pack opening history
        await client.query(
          `DELETE FROM "pack_opening_history" WHERE user_id = $1`,
          [userId]
        );

        // Delete mail
        await client.query(`DELETE FROM "mail" WHERE user_id = $1`, [userId]);

        // Delete fate pick participations
        await client.query(
          `DELETE FROM "fate_pick_participations" WHERE participant_id = $1`,
          [userId]
        );

        // Delete fate picks created by user
        await client.query(
          `DELETE FROM "fate_picks" WHERE original_owner_id = $1`,
          [userId]
        );

        // Delete friendships (both as requester and addressee)
        await client.query(
          `DELETE FROM "friendships" WHERE requester_id = $1 OR addressee_id = $1`,
          [userId]
        );

        // Delete user rankings
        await client.query(`DELETE FROM "user_rankings" WHERE user_id = $1`, [
          userId,
        ]);

        // Delete game results
        await client.query(
          `DELETE FROM "game_results" WHERE player1_id = $1 OR player2_id = $1`,
          [userId]
        );

        // Delete games (decks will cascade)
        await client.query(
          `DELETE FROM "games" WHERE player1_id = $1 OR player2_id = $1`,
          [userId]
        );

        // Delete decks (deck_cards will cascade)
        await client.query(`DELETE FROM "decks" WHERE user_id = $1`, [userId]);

        // Delete user owned cards (user_card_power_ups will cascade)
        await client.query(
          `DELETE FROM "user_owned_cards" WHERE user_id = $1`,
          [userId]
        );

        // Delete sessions (should be cleared already, but ensure)
        await client.query(`DELETE FROM "sessions" WHERE user_id = $1`, [userId]);

        // Finally, delete the user record itself
        await client.query(`DELETE FROM "users" WHERE user_id = $1`, [userId]);

        await client.query("COMMIT");

        logger.info("Account deleted successfully", { userId });

        return res.status(200).json({
          message: "Account deleted successfully.",
        });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error(
        "Delete account error",
        { userId: req.user?.user_id },
        error instanceof Error ? error : new Error(String(error))
      );
      return res.status(500).json({
        error: {
          message: "Failed to delete account.",
          details: error instanceof Error ? error.message : "Unknown error",
        },
      });
    }
  },
};
export default UserController;
