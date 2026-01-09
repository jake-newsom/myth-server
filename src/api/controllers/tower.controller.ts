/**
 * Tower Controller - Handles Infinite Tower API endpoints
 */

import { Response } from "express";
import { AuthenticatedRequest } from "../../types/middleware.types";
import TowerService from "../../services/tower.service";

export class TowerController {
  /**
   * Get user's tower progress and nearby floors
   * GET /api/tower/progress
   */
  static async getProgress(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    try {
      const userId = req.user?.user_id;

      if (!userId) {
        res.status(401).json({
          error: "User not authenticated",
        });
        return;
      }

      const progress = await TowerService.getUserTowerProgress(userId);

      res.status(200).json({
        status: "success",
        data: progress,
      });
    } catch (error) {
      console.error("Error getting tower progress:", error);
      res.status(500).json({
        error:
          error instanceof Error ? error.message : "Failed to get tower progress",
      });
    }
  }

  /**
   * Get available floors near user's current progress
   * GET /api/tower/floors
   */
  static async getFloors(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    try {
      const userId = req.user?.user_id;

      if (!userId) {
        res.status(401).json({
          error: "User not authenticated",
        });
        return;
      }

      const range = parseInt(req.query.range as string) || 5;
      const floorsData = await TowerService.getFloorsNearUser(userId, range);

      res.status(200).json({
        status: "success",
        data: floorsData,
      });
    } catch (error) {
      console.error("Error getting tower floors:", error);
      res.status(500).json({
        error:
          error instanceof Error ? error.message : "Failed to get tower floors",
      });
    }
  }

  /**
   * Preview rewards for a specific floor
   * GET /api/tower/rewards/:floor
   */
  static async getRewardsPreview(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    try {
      const floorNumber = parseInt(req.params.floor);

      if (!floorNumber || floorNumber < 1) {
        res.status(400).json({
          error: "Invalid floor number",
        });
        return;
      }

      const rewards = TowerService.getTowerReward(floorNumber);

      res.status(200).json({
        status: "success",
        data: rewards,
      });
    } catch (error) {
      console.error("Error getting rewards preview:", error);
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to get rewards preview",
      });
    }
  }

  /**
   * Start a tower game for the user's current floor
   * POST /api/tower/start
   */
  static async startGame(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    try {
      const userId = req.user?.user_id;

      if (!userId) {
        res.status(401).json({
          error: "User not authenticated",
        });
        return;
      }

      const { player_deck_id } = req.body;

      if (!player_deck_id) {
        res.status(400).json({
          error: "player_deck_id is required",
        });
        return;
      }

      const gameStart = await TowerService.startTowerGame(
        userId,
        player_deck_id
      );

      res.status(200).json({
        status: "success",
        message: "Tower game started successfully",
        data: gameStart,
      });
    } catch (error) {
      console.error("Error starting tower game:", error);

      if (
        error instanceof Error &&
        (error.message.includes("not available") ||
          error.message.includes("empty") ||
          error.message.includes("not found"))
      ) {
        res.status(400).json({
          error: error.message,
        });
        return;
      }

      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to start tower game",
      });
    }
  }

  /**
   * Get a specific floor's details
   * GET /api/tower/floor/:floorNumber
   */
  static async getFloor(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    try {
      const floorNumber = parseInt(req.params.floorNumber);

      if (!floorNumber || floorNumber < 1) {
        res.status(400).json({
          error: "Invalid floor number",
        });
        return;
      }

      const floor = await TowerService.getTowerFloor(floorNumber);

      if (!floor) {
        res.status(404).json({
          error: "Floor not found",
        });
        return;
      }

      // Include reward preview
      const rewards = TowerService.getTowerReward(floorNumber);

      res.status(200).json({
        status: "success",
        data: {
          ...floor,
          reward_preview: rewards,
        },
      });
    } catch (error) {
      console.error("Error getting tower floor:", error);
      res.status(500).json({
        error:
          error instanceof Error ? error.message : "Failed to get tower floor",
      });
    }
  }

  /**
   * Process tower game completion
   * This is called internally when a game with floor_number completes
   * POST /api/tower/complete (internal use)
   */
  static async processCompletion(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    try {
      const userId = req.user?.user_id;

      if (!userId) {
        res.status(401).json({
          error: "User not authenticated",
        });
        return;
      }

      const { floor_number, won, game_id } = req.body;

      if (floor_number === undefined || won === undefined) {
        res.status(400).json({
          error: "floor_number and won are required",
        });
        return;
      }

      const result = await TowerService.processTowerCompletion(
        userId,
        floor_number,
        won,
        game_id
      );

      res.status(200).json({
        status: "success",
        message: won
          ? "Floor completed successfully!"
          : "Better luck next time!",
        data: result,
      });
    } catch (error) {
      console.error("Error processing tower completion:", error);
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to process tower completion",
      });
    }
  }
}

export default TowerController;


