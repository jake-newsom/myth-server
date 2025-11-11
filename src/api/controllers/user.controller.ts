// src/api/controllers/user.controller.ts
import UserModel from "../../models/user.model";
import CardModel from "../../models/card.model";
import DeckModel from "../../models/deck.model";
import GameService from "../../services/game.service";
import { Request, Response, NextFunction } from "express"; // Assuming Express types
import {
  UserCard,
  CardResponse,
  AuthenticatedRequest,
  TriggerMoment,
} from "../../types";

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
};
export default UserController;
