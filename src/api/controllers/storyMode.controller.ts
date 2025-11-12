import { Request, Response } from "express";
import { StoryModeService } from "../../services/storyMode.service";
import {
  CreateStoryModeRequest,
  UpdateStoryModeRequest,
  StoryGameStartRequest,
  StoryDifficulty
} from "../../types/story-mode.types";
import { AuthenticatedRequest } from "../../types/middleware.types";

export class StoryModeController {

  // Admin endpoints for managing story mode configurations

  /**
   * Create a new story mode configuration
   * POST /api/admin/story-modes
   */
  static async createStoryMode(req: Request, res: Response): Promise<void> {
    try {
      const createRequest: CreateStoryModeRequest = req.body;

      // Validate required fields
      if (!createRequest.name || !createRequest.difficulty || !createRequest.ai_deck_id) {
        res.status(400).json({
          error: "Missing required fields: name, difficulty, ai_deck_id"
        });
        return;
      }

      // Validate difficulty (must be 1-5)
      if (!createRequest.difficulty || 
          typeof createRequest.difficulty !== 'number' || 
          createRequest.difficulty < 1 || 
          createRequest.difficulty > 5) {
        res.status(400).json({
          error: 'Invalid difficulty. Must be an integer between 1 and 5'
        });
        return;
      }

      // Validate rewards array
      if (!createRequest.rewards || !Array.isArray(createRequest.rewards) || createRequest.rewards.length === 0) {
        res.status(400).json({
          error: "At least one reward configuration is required"
        });
        return;
      }

      const storyMode = await StoryModeService.createStoryMode(createRequest);

      res.status(201).json({
        message: "Story mode created successfully",
        story_mode: storyMode
      });

    } catch (error) {
      console.error("Error creating story mode:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to create story mode"
      });
    }
  }

  /**
   * Update an existing story mode configuration
   * PUT /api/admin/story-modes/:storyId
   */
  static async updateStoryMode(req: Request, res: Response): Promise<void> {
    try {
      const { storyId } = req.params;
      const updateRequest: UpdateStoryModeRequest = req.body;

      if (!storyId) {
        res.status(400).json({
          error: "Story ID is required"
        });
        return;
      }

      // Validate difficulty if provided (must be 1-5)
      if (updateRequest.difficulty !== undefined) {
        if (typeof updateRequest.difficulty !== 'number' || 
            updateRequest.difficulty < 1 || 
            updateRequest.difficulty > 5) {
          res.status(400).json({
            error: 'Invalid difficulty. Must be an integer between 1 and 5'
          });
          return;
        }
      }

      const storyMode = await StoryModeService.updateStoryMode(storyId, updateRequest);

      res.status(200).json({
        message: "Story mode updated successfully",
        story_mode: storyMode
      });

    } catch (error) {
      console.error("Error updating story mode:", error);
      
      if (error instanceof Error && error.message.includes("not found")) {
        res.status(404).json({
          error: error.message
        });
        return;
      }

      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to update story mode"
      });
    }
  }

  /**
   * Delete a story mode configuration
   * DELETE /api/admin/story-modes/:storyId
   */
  static async deleteStoryMode(req: Request, res: Response): Promise<void> {
    try {
      const { storyId } = req.params;

      if (!storyId) {
        res.status(400).json({
          error: "Story ID is required"
        });
        return;
      }

      await StoryModeService.deleteStoryMode(storyId);

      res.status(200).json({
        message: "Story mode deleted successfully"
      });

    } catch (error) {
      console.error("Error deleting story mode:", error);
      
      if (error instanceof Error && error.message.includes("not found")) {
        res.status(404).json({
          error: error.message
        });
        return;
      }

      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to delete story mode"
      });
    }
  }

  /**
   * Get a single story mode configuration
   * GET /api/admin/story-modes/:storyId
   */
  static async getStoryMode(req: Request, res: Response): Promise<void> {
    try {
      const { storyId } = req.params;

      if (!storyId) {
        res.status(400).json({
          error: "Story ID is required"
        });
        return;
      }

      const storyMode = await StoryModeService.getStoryMode(storyId);

      if (!storyMode) {
        res.status(404).json({
          error: "Story mode not found"
        });
        return;
      }

      res.status(200).json({
        story_mode: storyMode
      });

    } catch (error) {
      console.error("Error getting story mode:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to get story mode"
      });
    }
  }

  /**
   * Get all story mode configurations (admin view)
   * GET /api/admin/story-modes
   */
  static async getAllStoryModes(req: Request, res: Response): Promise<void> {
    try {
      // For admin view, we'll get all story modes without user-specific data
      // This is a simplified version - you might want to add pagination, filtering, etc.
      
      // For now, we'll use a dummy user ID to get the structure
      // In a real implementation, you might want a separate admin method
      const dummyUserId = "00000000-0000-0000-0000-000000000000";
      const storyModes = await StoryModeService.getAvailableStoryModes(dummyUserId);

      res.status(200).json({
        story_modes: storyModes.story_modes.map(sm => ({
          story_id: sm.story_id,
          name: sm.name,
          description: sm.description,
          difficulty: sm.difficulty,
          ai_deck_id: sm.ai_deck_id,
          order_index: sm.order_index,
          is_active: sm.is_active,
          unlock_requirements: sm.unlock_requirements,
          rewards: sm.rewards,
          created_at: sm.created_at,
          updated_at: sm.updated_at
        })),
        total_count: storyModes.total_count
      });

    } catch (error) {
      console.error("Error getting all story modes:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to get story modes"
      });
    }
  }

  // Player endpoints for interacting with story modes

  /**
   * Get available story modes for the authenticated user
   * GET /api/story-modes
   */
  static async getAvailableStoryModes(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.user_id;

      if (!userId) {
        res.status(401).json({
          error: "User not authenticated"
        });
        return;
      }

      const storyModes = await StoryModeService.getAvailableStoryModes(userId);

      res.status(200).json(storyModes);

    } catch (error) {
      console.error("Error getting available story modes:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to get available story modes"
      });
    }
  }

  /**
   * Start a story mode game
   * POST /api/story-modes/start
   */
  static async startStoryGame(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.user_id;

      if (!userId) {
        res.status(401).json({
          error: "User not authenticated"
        });
        return;
      }

      const startRequest: StoryGameStartRequest = req.body;

      // Validate required fields
      if (!startRequest.story_id || !startRequest.player_deck_id) {
        res.status(400).json({
          error: "Missing required fields: story_id, player_deck_id"
        });
        return;
      }

      const gameStart = await StoryModeService.startStoryGame(userId, startRequest);

      res.status(200).json({
        message: "Story game started successfully",
        ...gameStart
      });

    } catch (error) {
      console.error("Error starting story game:", error);
      
      if (error instanceof Error && (
        error.message.includes("not found") ||
        error.message.includes("not active") ||
        error.message.includes("requirements")
      )) {
        res.status(400).json({
          error: error.message
        });
        return;
      }

      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to start story game"
      });
    }
  }

  /**
   * Get user's story mode progress
   * GET /api/story-modes/progress
   * GET /api/story-modes/progress/:storyId
   */
  static async getUserProgress(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.user_id;

      if (!userId) {
        res.status(401).json({
          error: "User not authenticated"
        });
        return;
      }

      const { storyId } = req.params;
      const progress = await StoryModeService.getUserProgress(userId, storyId);

      res.status(200).json({
        progress: storyId ? progress[0] || null : progress
      });

    } catch (error) {
      console.error("Error getting user progress:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to get user progress"
      });
    }
  }

  /**
   * Process story mode game completion (called by game system)
   * POST /api/story-modes/complete
   */
  static async processStoryCompletion(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.user_id;

      if (!userId) {
        res.status(401).json({
          error: "User not authenticated"
        });
        return;
      }

      const { story_id, game_result, completion_time_seconds } = req.body;

      // Validate required fields
      if (!story_id || !game_result) {
        res.status(400).json({
          error: "Missing required fields: story_id, game_result"
        });
        return;
      }

      const completionResult = await StoryModeService.processStoryCompletion(
        userId,
        story_id,
        game_result,
        completion_time_seconds || 0
      );

      res.status(200).json({
        message: "Story completion processed successfully",
        ...completionResult
      });

    } catch (error) {
      console.error("Error processing story completion:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to process story completion"
      });
    }
  }

  /**
   * Check if user can unlock a specific story mode
   * GET /api/story-modes/:storyId/unlock-status
   */
  static async checkUnlockStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.user_id;

      if (!userId) {
        res.status(401).json({
          error: "User not authenticated"
        });
        return;
      }

      const { storyId } = req.params;

      if (!storyId) {
        res.status(400).json({
          error: "Story ID is required"
        });
        return;
      }

      const isUnlocked = await StoryModeService.checkUnlockRequirements(userId, storyId);

      res.status(200).json({
        story_id: storyId,
        is_unlocked: isUnlocked
      });

    } catch (error) {
      console.error("Error checking unlock status:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to check unlock status"
      });
    }
  }
}
