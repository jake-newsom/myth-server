// src/api/controllers/user.controller.ts
import UserModel from "../../models/user.model";
import CardModel from "../../models/card.model";
import DeckModel from "../../models/deck.model";
import { Request, Response, NextFunction } from "express"; // Assuming Express types

interface AuthenticatedRequest extends Request {
  user?: { user_id: string /* other user props */ };
}

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
      res.status(200).json(ownedCardInstances);
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
      res.status(200).json(userDecks);
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
      res.status(200).json(deck);
    } catch (error) {
      next(error);
    }
  },
};
export default UserController;
