// Story Mode Types and Interfaces

// Difficulty levels: 1-5 (corresponds to AI card levels)
// Level 1 = Easy, Level 2 = Normal, Level 3 = Hard, Level 4 = Expert, Level 5 = Mythic
export type StoryDifficulty = 1 | 2 | 3 | 4 | 5;

export type RewardType = 'first_win' | 'repeat_win' | 'achievement' | 'milestone';

export interface UnlockRequirements {
  // Require completing other story modes first
  prerequisite_stories?: string[]; // Array of story_ids
  
  // Require minimum user level
  min_user_level?: number;
  
  // Require specific achievements
  required_achievements?: string[]; // Array of achievement_ids
  
  // Require minimum number of total story wins
  min_total_story_wins?: number;
  
  // Custom unlock conditions (for future extensibility)
  custom_conditions?: Record<string, any>;
}

export interface RewardData {
  // Currency rewards
  gold?: number;
  gems?: number;
  fate_coins?: number;
  card_fragments?: number;
  
  // Card rewards
  specific_cards?: string[]; // Array of card_ids
  random_cards?: {
    count: number;
    rarity?: string; // Filter by rarity
    set_id?: string; // Filter by set
  };
  
  // Pack rewards
  packs?: {
    set_id: string;
    count: number;
  }[];
  
  // XP rewards
  card_xp?: number;
  
  // Achievement unlocks
  achievements?: string[]; // Array of achievement_ids to unlock
  
  // Custom rewards (for future extensibility)
  custom_rewards?: Record<string, any>;
}

export interface StoryModeConfig {
  story_id: string;
  name: string;
  description?: string;
  difficulty: StoryDifficulty;
  ai_deck_id: string;
  order_index: number;
  is_active: boolean;
  unlock_requirements: UnlockRequirements;
  created_at: Date;
  updated_at: Date;
}

export interface StoryModeReward {
  reward_id: string;
  story_id: string;
  reward_type: RewardType;
  reward_data: RewardData;
  is_active: boolean;
  created_at: Date;
}

export interface UserStoryProgress {
  progress_id: string;
  user_id: string;
  story_id: string;
  times_completed: number;
  first_completed_at?: Date;
  last_completed_at?: Date;
  best_completion_time?: number; // in seconds
  total_attempts: number;
  created_at: Date;
  updated_at: Date;
}

// API Request/Response Types

export interface CreateStoryModeRequest {
  name: string;
  description?: string;
  difficulty: StoryDifficulty;
  ai_deck_id: string;
  order_index?: number;
  unlock_requirements?: UnlockRequirements;
  rewards: Omit<StoryModeReward, 'reward_id' | 'story_id' | 'created_at'>[];
}

export interface UpdateStoryModeRequest {
  name?: string;
  description?: string;
  difficulty?: StoryDifficulty;
  ai_deck_id?: string;
  order_index?: number;
  is_active?: boolean;
  unlock_requirements?: UnlockRequirements;
}

export interface StoryModeWithRewards extends StoryModeConfig {
  rewards: StoryModeReward[];
}

export interface StoryModeWithProgress extends StoryModeWithRewards {
  user_progress?: UserStoryProgress;
  is_unlocked: boolean;
  can_play: boolean; // Considers unlock requirements and active status
  preview_cards?: string[]; // Array of top 3 strongest card_ids from AI deck
}

export interface StoryModeListResponse {
  stories: StoryModeWithProgress[];
  total_count: number;
}

export interface StoryGameStartRequest {
  story_id: string;
  player_deck_id: string;
}

export interface StoryGameStartResponse {
  game_id: string;
  story_config: StoryModeConfig;
  ai_deck_preview?: {
    name: string;
    card_count: number;
  };
}

export interface StoryGameCompletionRewards {
  rewards_earned: RewardData;
  is_first_win: boolean;
  new_progress: UserStoryProgress;
  unlocked_stories?: string[]; // story_ids that were unlocked by this completion
}

// Service Layer Types

export interface StoryModeService {
  // Configuration management
  createStoryMode(config: CreateStoryModeRequest): Promise<StoryModeWithRewards>;
  updateStoryMode(storyId: string, updates: UpdateStoryModeRequest): Promise<StoryModeWithRewards>;
  deleteStoryMode(storyId: string): Promise<void>;
  getStoryMode(storyId: string): Promise<StoryModeWithRewards | null>;
  
  // User-facing methods
  getAvailableStoryModes(userId: string): Promise<StoryModeListResponse>;
  checkUnlockRequirements(userId: string, storyId: string): Promise<boolean>;
  
  // Game integration
  startStoryGame(userId: string, request: StoryGameStartRequest): Promise<StoryGameStartResponse>;
  processStoryCompletion(
    userId: string, 
    storyId: string, 
    gameResult: any, 
    completionTimeSeconds: number
  ): Promise<StoryGameCompletionRewards>;
  
  // Progress tracking
  getUserProgress(userId: string, storyId?: string): Promise<UserStoryProgress[]>;
  updateUserProgress(userId: string, storyId: string, won: boolean, completionTimeSeconds?: number): Promise<UserStoryProgress>;
}

// Database Model Types (for internal use)

export interface StoryModeConfigRow {
  story_id: string;
  name: string;
  description: string | null;
  difficulty: StoryDifficulty;
  ai_deck_id: string;
  order_index: number;
  is_active: boolean;
  unlock_requirements: string; // JSON string
  created_at: string;
  updated_at: string;
}

export interface StoryModeRewardRow {
  reward_id: string;
  story_id: string;
  reward_type: RewardType;
  reward_data: string; // JSON string
  is_active: boolean;
  created_at: string;
}

export interface UserStoryProgressRow {
  progress_id: string;
  user_id: string;
  story_id: string;
  times_completed: number;
  first_completed_at: string | null;
  last_completed_at: string | null;
  best_completion_time: number | null;
  total_attempts: number;
  created_at: string;
  updated_at: string;
}
