import db from "../config/db.config";
import { PoolClient } from "pg";
import {
  StoryModeConfig,
  StoryModeReward,
  UserStoryProgress,
  StoryModeWithRewards,
  StoryModeWithProgress,
  StoryModeListResponse,
  CreateStoryModeRequest,
  UpdateStoryModeRequest,
  StoryGameStartRequest,
  StoryGameStartResponse,
  StoryGameCompletionRewards,
  UnlockRequirements,
  RewardData,
  StoryModeConfigRow,
  StoryModeRewardRow,
  UserStoryProgressRow,
  StoryDifficulty,
  RewardType
} from "../types/story-mode.types";
import UserModel from "../models/user.model";
import GameRewardsService from "./gameRewards.service";

export class StoryModeService {
  
  // Helper method to convert database row to StoryModeConfig
  private static rowToStoryModeConfig(row: StoryModeConfigRow): StoryModeConfig {
    return {
      story_id: row.story_id,
      name: row.name,
      description: row.description || undefined,
      difficulty: row.difficulty,
      ai_deck_id: row.ai_deck_id,
      order_index: row.order_index,
      is_active: row.is_active,
      unlock_requirements: JSON.parse(row.unlock_requirements),
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at)
    };
  }

  // Helper method to convert database row to StoryModeReward
  private static rowToStoryModeReward(row: StoryModeRewardRow): StoryModeReward {
    return {
      reward_id: row.reward_id,
      story_id: row.story_id,
      reward_type: row.reward_type,
      reward_data: JSON.parse(row.reward_data),
      is_active: row.is_active,
      created_at: new Date(row.created_at)
    };
  }

  // Helper method to convert database row to UserStoryProgress
  private static rowToUserStoryProgress(row: UserStoryProgressRow): UserStoryProgress {
    return {
      progress_id: row.progress_id,
      user_id: row.user_id,
      story_id: row.story_id,
      times_completed: row.times_completed,
      first_completed_at: row.first_completed_at ? new Date(row.first_completed_at) : undefined,
      last_completed_at: row.last_completed_at ? new Date(row.last_completed_at) : undefined,
      best_completion_time: row.best_completion_time || undefined,
      total_attempts: row.total_attempts,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at)
    };
  }

  // Create a new story mode configuration
  static async createStoryMode(config: CreateStoryModeRequest): Promise<StoryModeWithRewards> {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');

      // Validate that the AI deck exists
      const deckCheck = await client.query(
        'SELECT deck_id FROM decks WHERE deck_id = $1',
        [config.ai_deck_id]
      );
      
      if (deckCheck.rows.length === 0) {
        throw new Error(`AI deck with ID ${config.ai_deck_id} not found`);
      }

      // Set order_index if not provided
      const orderIndex = config.order_index ?? await this.getNextOrderIndex(client);

      // Create the story mode configuration
      const storyResult = await client.query(`
        INSERT INTO story_mode_config (
          name, description, difficulty, ai_deck_id, order_index, unlock_requirements
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [
        config.name,
        config.description || null,
        config.difficulty,
        config.ai_deck_id,
        orderIndex,
        JSON.stringify(config.unlock_requirements || {})
      ]);

      const storyConfig = this.rowToStoryModeConfig(storyResult.rows[0]);

      // Create rewards
      const rewards: StoryModeReward[] = [];
      for (const rewardConfig of config.rewards) {
        const rewardResult = await client.query(`
          INSERT INTO story_mode_rewards (
            story_id, reward_type, reward_data, is_active
          ) VALUES ($1, $2, $3, $4)
          RETURNING *
        `, [
          storyConfig.story_id,
          rewardConfig.reward_type,
          JSON.stringify(rewardConfig.reward_data),
          rewardConfig.is_active
        ]);

        rewards.push(this.rowToStoryModeReward(rewardResult.rows[0]));
      }

      await client.query('COMMIT');

      return {
        ...storyConfig,
        rewards
      };

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Update an existing story mode configuration
  static async updateStoryMode(storyId: string, updates: UpdateStoryModeRequest): Promise<StoryModeWithRewards> {
    const client = await db.getClient();
    
    try {
      // Validate that the AI deck exists if being updated
      if (updates.ai_deck_id) {
        const deckCheck = await client.query(
          'SELECT deck_id FROM decks WHERE deck_id = $1',
          [updates.ai_deck_id]
        );
        
        if (deckCheck.rows.length === 0) {
          throw new Error(`AI deck with ID ${updates.ai_deck_id} not found`);
        }
      }

      // Build dynamic update query
      const updateFields: string[] = [];
      const updateValues: any[] = [];
      let paramIndex = 1;

      if (updates.name !== undefined) {
        updateFields.push(`name = $${paramIndex++}`);
        updateValues.push(updates.name);
      }
      if (updates.description !== undefined) {
        updateFields.push(`description = $${paramIndex++}`);
        updateValues.push(updates.description);
      }
      if (updates.difficulty !== undefined) {
        updateFields.push(`difficulty = $${paramIndex++}`);
        updateValues.push(updates.difficulty);
      }
      if (updates.ai_deck_id !== undefined) {
        updateFields.push(`ai_deck_id = $${paramIndex++}`);
        updateValues.push(updates.ai_deck_id);
      }
      if (updates.order_index !== undefined) {
        updateFields.push(`order_index = $${paramIndex++}`);
        updateValues.push(updates.order_index);
      }
      if (updates.is_active !== undefined) {
        updateFields.push(`is_active = $${paramIndex++}`);
        updateValues.push(updates.is_active);
      }
      if (updates.unlock_requirements !== undefined) {
        updateFields.push(`unlock_requirements = $${paramIndex++}`);
        updateValues.push(JSON.stringify(updates.unlock_requirements));
      }

      if (updateFields.length === 0) {
        throw new Error('No fields to update');
      }

      updateValues.push(storyId);

      const updateQuery = `
        UPDATE story_mode_config 
        SET ${updateFields.join(', ')}
        WHERE story_id = $${paramIndex}
        RETURNING *
      `;

      const result = await client.query(updateQuery, updateValues);
      
      if (result.rows.length === 0) {
        throw new Error(`Story mode with ID ${storyId} not found`);
      }

      const storyConfig = this.rowToStoryModeConfig(result.rows[0]);

      // Get rewards
      const rewards = await this.getStoryModeRewards(client, storyId);

      return {
        ...storyConfig,
        rewards
      };

    } finally {
      client.release();
    }
  }

  // Delete a story mode configuration
  static async deleteStoryMode(storyId: string): Promise<void> {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');

      // Delete rewards first (due to foreign key constraint)
      await client.query('DELETE FROM story_mode_rewards WHERE story_id = $1', [storyId]);
      
      // Delete user progress
      await client.query('DELETE FROM user_story_progress WHERE story_id = $1', [storyId]);

      // Delete the story mode configuration
      const result = await client.query('DELETE FROM story_mode_config WHERE story_id = $1', [storyId]);
      
      if (result.rowCount === 0) {
        throw new Error(`Story mode with ID ${storyId} not found`);
      }

      await client.query('COMMIT');

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Get a single story mode configuration with rewards
  static async getStoryMode(storyId: string): Promise<StoryModeWithRewards | null> {
    const client = await db.getClient();
    
    try {
      const storyResult = await client.query(
        'SELECT * FROM story_mode_config WHERE story_id = $1',
        [storyId]
      );

      if (storyResult.rows.length === 0) {
        return null;
      }

      const storyConfig = this.rowToStoryModeConfig(storyResult.rows[0]);
      const rewards = await this.getStoryModeRewards(client, storyId);

      return {
        ...storyConfig,
        rewards
      };

    } finally {
      client.release();
    }
  }

  // Get available story modes for a user (with progress and unlock status)
  static async getAvailableStoryModes(userId: string): Promise<StoryModeListResponse> {
    const client = await db.getClient();
    
    try {
      // Get all active story modes ordered by order_index
      const storyResult = await client.query(`
        SELECT * FROM story_mode_config 
        WHERE is_active = true 
        ORDER BY order_index ASC
      `);

      const storyModes: StoryModeWithProgress[] = [];

      for (const storyRow of storyResult.rows) {
        const storyConfig = this.rowToStoryModeConfig(storyRow);
        
        // Get rewards for this story mode
        const rewards = await this.getStoryModeRewards(client, storyConfig.story_id);
        
        // Get user progress for this story mode
        const progressResult = await client.query(
          'SELECT * FROM user_story_progress WHERE user_id = $1 AND story_id = $2',
          [userId, storyConfig.story_id]
        );

        const userProgress = progressResult.rows.length > 0 
          ? this.rowToUserStoryProgress(progressResult.rows[0])
          : undefined;

        // Check if user can unlock/play this story mode
        const isUnlocked = await this.checkUnlockRequirements(userId, storyConfig.story_id, client);
        const canPlay = isUnlocked && storyConfig.is_active;

        storyModes.push({
          ...storyConfig,
          rewards,
          user_progress: userProgress,
          is_unlocked: isUnlocked,
          can_play: canPlay
        });
      }

      return {
        story_modes: storyModes,
        total_count: storyModes.length
      };

    } finally {
      client.release();
    }
  }

  // Check if a user meets the unlock requirements for a story mode
  static async checkUnlockRequirements(
    userId: string, 
    storyId: string, 
    client?: PoolClient
  ): Promise<boolean> {
    const dbClient = client || await db.getClient();
    const shouldRelease = !client;
    
    try {
      // Get the story mode configuration
      const storyResult = await dbClient.query(
        'SELECT unlock_requirements FROM story_mode_config WHERE story_id = $1',
        [storyId]
      );

      if (storyResult.rows.length === 0) {
        return false;
      }

      const requirements: UnlockRequirements = JSON.parse(storyResult.rows[0].unlock_requirements);

      // If no requirements, it's unlocked
      if (!requirements || Object.keys(requirements).length === 0) {
        return true;
      }

      // Check prerequisite stories
      if (requirements.prerequisite_stories && requirements.prerequisite_stories.length > 0) {
        const completedStories = await dbClient.query(`
          SELECT story_id FROM user_story_progress 
          WHERE user_id = $1 AND story_id = ANY($2) AND times_completed > 0
        `, [userId, requirements.prerequisite_stories]);

        if (completedStories.rows.length < requirements.prerequisite_stories.length) {
          return false;
        }
      }

      // Check minimum user level
      if (requirements.min_user_level) {
        const userResult = await dbClient.query(
          'SELECT level FROM users WHERE user_id = $1',
          [userId]
        );

        if (userResult.rows.length === 0 || userResult.rows[0].level < requirements.min_user_level) {
          return false;
        }
      }

      // Check required achievements
      if (requirements.required_achievements && requirements.required_achievements.length > 0) {
        const completedAchievements = await dbClient.query(`
          SELECT achievement_id FROM user_achievements 
          WHERE user_id = $1 AND achievement_id = ANY($2) AND completed_at IS NOT NULL
        `, [userId, requirements.required_achievements]);

        if (completedAchievements.rows.length < requirements.required_achievements.length) {
          return false;
        }
      }

      // Check minimum total story wins
      if (requirements.min_total_story_wins) {
        const totalWinsResult = await dbClient.query(`
          SELECT COALESCE(SUM(times_completed), 0) as total_wins
          FROM user_story_progress 
          WHERE user_id = $1
        `, [userId]);

        const totalWins = parseInt(totalWinsResult.rows[0].total_wins);
        if (totalWins < requirements.min_total_story_wins) {
          return false;
        }
      }

      // All requirements met
      return true;

    } finally {
      if (shouldRelease) {
        dbClient.release();
      }
    }
  }

  // Start a story mode game
  static async startStoryGame(userId: string, request: StoryGameStartRequest): Promise<StoryGameStartResponse> {
    const client = await db.getClient();
    
    try {
      // Verify the story mode exists and user can play it
      const storyConfig = await this.getStoryMode(request.story_id);
      if (!storyConfig) {
        throw new Error(`Story mode with ID ${request.story_id} not found`);
      }

      if (!storyConfig.is_active) {
        throw new Error('This story mode is not currently active');
      }

      const canPlay = await this.checkUnlockRequirements(userId, request.story_id, client);
      if (!canPlay) {
        throw new Error('You do not meet the requirements to play this story mode');
      }

      // Verify the player's deck exists
      const deckResult = await client.query(
        'SELECT name FROM decks WHERE deck_id = $1 AND user_id = $2',
        [request.player_deck_id, userId]
      );

      if (deckResult.rows.length === 0) {
        throw new Error('Player deck not found or does not belong to user');
      }

      // Get AI deck info for preview
      const aiDeckResult = await client.query(
        'SELECT name FROM decks WHERE deck_id = $1',
        [storyConfig.ai_deck_id]
      );

      const aiDeckPreview = aiDeckResult.rows.length > 0 ? {
        name: aiDeckResult.rows[0].name,
        card_count: 20 // Assuming standard deck size
      } : undefined;

      // Create the game (this would integrate with your existing game creation logic)
      // For now, we'll return a mock game_id - you'll need to integrate with GameService
      const gameId = 'story-game-' + Date.now(); // Replace with actual game creation

      return {
        game_id: gameId,
        story_config: storyConfig,
        ai_deck_preview: aiDeckPreview
      };

    } finally {
      client.release();
    }
  }

  // Process story mode completion and award rewards
  static async processStoryCompletion(
    userId: string,
    storyId: string,
    gameResult: any,
    completionTimeSeconds: number
  ): Promise<StoryGameCompletionRewards> {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');

      const won = gameResult.winner_id === userId;

      // Update user progress
      const updatedProgress = await this.updateUserProgress(
        userId, 
        storyId, 
        won, 
        completionTimeSeconds, 
        client
      );

      const isFirstWin = updatedProgress.times_completed === 1 && won;

      // Calculate and award rewards
      const rewardsEarned: RewardData = {};
      
      if (won) {
        // Get appropriate rewards (first win vs repeat win)
        const rewardType: RewardType = isFirstWin ? 'first_win' : 'repeat_win';
        const rewardsResult = await client.query(`
          SELECT reward_data FROM story_mode_rewards 
          WHERE story_id = $1 AND reward_type = $2 AND is_active = true
        `, [storyId, rewardType]);

        for (const rewardRow of rewardsResult.rows) {
          const rewardData: RewardData = JSON.parse(rewardRow.reward_data);
          
          // Merge rewards
          if (rewardData.gold) rewardsEarned.gold = (rewardsEarned.gold || 0) + rewardData.gold;
          if (rewardData.gems) rewardsEarned.gems = (rewardsEarned.gems || 0) + rewardData.gems;
          if (rewardData.fate_coins) rewardsEarned.fate_coins = (rewardsEarned.fate_coins || 0) + rewardData.fate_coins;
          if (rewardData.card_fragments) rewardsEarned.card_fragments = (rewardsEarned.card_fragments || 0) + rewardData.card_fragments;
          
          // Handle other reward types as needed
          if (rewardData.specific_cards) {
            rewardsEarned.specific_cards = [...(rewardsEarned.specific_cards || []), ...rewardData.specific_cards];
          }
        }

        // Award currency rewards
        if (rewardsEarned.gold || rewardsEarned.gems) {
          await UserModel.updateBothCurrencies(
            userId,
            rewardsEarned.gold || 0,
            rewardsEarned.gems || 0
          );
        }

        if (rewardsEarned.fate_coins) {
          await UserModel.updateFateCoins(userId, rewardsEarned.fate_coins);
        }

        // TODO: Handle other reward types (cards, packs, achievements, etc.)
      }

      // Check for newly unlocked story modes
      const unlockedStories = await this.checkForNewlyUnlockedStories(userId, client);

      await client.query('COMMIT');

      return {
        rewards_earned: rewardsEarned,
        is_first_win: isFirstWin,
        new_progress: updatedProgress,
        unlocked_stories: unlockedStories
      };

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Get user progress for story modes
  static async getUserProgress(userId: string, storyId?: string): Promise<UserStoryProgress[]> {
    const client = await db.getClient();
    
    try {
      let query = 'SELECT * FROM user_story_progress WHERE user_id = $1';
      const params = [userId];

      if (storyId) {
        query += ' AND story_id = $2';
        params.push(storyId);
      }

      query += ' ORDER BY updated_at DESC';

      const result = await client.query(query, params);
      return result.rows.map(row => this.rowToUserStoryProgress(row));

    } finally {
      client.release();
    }
  }

  // Update user progress for a story mode
  static async updateUserProgress(
    userId: string,
    storyId: string,
    won: boolean,
    completionTimeSeconds?: number,
    client?: PoolClient
  ): Promise<UserStoryProgress> {
    const dbClient = client || await db.getClient();
    const shouldRelease = !client;
    
    try {
      // Get existing progress or create new
      const existingResult = await dbClient.query(
        'SELECT * FROM user_story_progress WHERE user_id = $1 AND story_id = $2',
        [userId, storyId]
      );

      if (existingResult.rows.length > 0) {
        // Update existing progress
        const existing = this.rowToUserStoryProgress(existingResult.rows[0]);
        
        const updateFields = [
          'total_attempts = total_attempts + 1'
        ];
        const updateParams: any[] = [userId, storyId];
        let paramIndex = 3;

        if (won) {
          updateFields.push('times_completed = times_completed + 1');
          updateFields.push(`last_completed_at = $${paramIndex++}`);
          updateParams.push(new Date().toISOString());

          if (!existing.first_completed_at) {
            updateFields.push(`first_completed_at = $${paramIndex++}`);
            updateParams.push(new Date().toISOString());
          }

          if (completionTimeSeconds && (!existing.best_completion_time || completionTimeSeconds < existing.best_completion_time)) {
            updateFields.push(`best_completion_time = $${paramIndex++}`);
            updateParams.push(completionTimeSeconds);
          }
        }

        const updateQuery = `
          UPDATE user_story_progress 
          SET ${updateFields.join(', ')}
          WHERE user_id = $1 AND story_id = $2
          RETURNING *
        `;

        const result = await dbClient.query(updateQuery, updateParams);
        return this.rowToUserStoryProgress(result.rows[0]);

      } else {
        // Create new progress entry
        const insertQuery = `
          INSERT INTO user_story_progress (
            user_id, story_id, times_completed, first_completed_at, 
            last_completed_at, best_completion_time, total_attempts
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *
        `;

        const now = new Date().toISOString();
        const params = [
          userId,
          storyId,
          won ? 1 : 0,
          won ? now : null,
          won ? now : null,
          won ? completionTimeSeconds : null,
          1
        ];

        const result = await dbClient.query(insertQuery, params);
        return this.rowToUserStoryProgress(result.rows[0]);
      }

    } finally {
      if (shouldRelease) {
        dbClient.release();
      }
    }
  }

  // Helper method to get rewards for a story mode
  private static async getStoryModeRewards(client: PoolClient, storyId: string): Promise<StoryModeReward[]> {
    const rewardsResult = await client.query(
      'SELECT * FROM story_mode_rewards WHERE story_id = $1 AND is_active = true ORDER BY reward_type',
      [storyId]
    );

    return rewardsResult.rows.map(row => this.rowToStoryModeReward(row));
  }

  // Helper method to get the next order index
  private static async getNextOrderIndex(client: PoolClient): Promise<number> {
    const result = await client.query(
      'SELECT COALESCE(MAX(order_index), -1) + 1 as next_index FROM story_mode_config WHERE is_active = true'
    );
    return result.rows[0].next_index;
  }

  // Helper method to check for newly unlocked story modes after completion
  private static async checkForNewlyUnlockedStories(userId: string, client: PoolClient): Promise<string[]> {
    // Get all story modes that might be unlocked
    const allStoriesResult = await client.query(
      'SELECT story_id FROM story_mode_config WHERE is_active = true'
    );

    const unlockedStories: string[] = [];

    for (const storyRow of allStoriesResult.rows) {
      const storyId = storyRow.story_id;
      
      // Check if this story is now unlocked
      const isUnlocked = await this.checkUnlockRequirements(userId, storyId, client);
      
      if (isUnlocked) {
        // Check if user has any progress (to see if it's newly unlocked)
        const progressResult = await client.query(
          'SELECT progress_id FROM user_story_progress WHERE user_id = $1 AND story_id = $2',
          [userId, storyId]
        );

        // If no progress exists, it's newly unlocked
        if (progressResult.rows.length === 0) {
          unlockedStories.push(storyId);
        }
      }
    }

    return unlockedStories;
  }
}
