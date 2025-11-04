import { PowerValues, Rarity } from "./card.types";
import { GameState } from "./game.types";
import {
  Friendship,
  FriendshipWithUser,
  Achievement,
  UserAchievement,
} from "./database.types";

/**
 * Service-specific type definitions
 * Consolidated from various service files to avoid duplication
 */

// Friends Service Types
export interface FriendRequestInput {
  addresseeUsername?: string;
  addresseeId?: string;
}

export interface FriendRequestResponse {
  success: boolean;
  message: string;
  friendship?: Friendship;
  error?: string;
}

export interface FriendsListResponse {
  success: boolean;
  friends: FriendshipWithUser[];
  stats: {
    friends_count: number;
    pending_incoming: number;
    pending_outgoing: number;
  };
}

export interface FriendRequestsResponse {
  success: boolean;
  incoming: FriendshipWithUser[];
  outgoing: FriendshipWithUser[];
  stats: {
    pending_incoming: number;
    pending_outgoing: number;
  };
}

export interface UserSearchResponse {
  success: boolean;
  users: Array<{ user_id: string; username: string; email: string }>;
  query: string;
}

// Game Service Types
export interface GameRecord {
  game_id: string;
  player1_id: string;
  player2_id: string;
  player1_deck_id: string;
  player2_deck_id: string;
  game_mode: string;
  game_status: import("../game-engine/game.logic").GameStatus;
  board_layout: string;
  game_state: GameState;
  created_at: Date;
  completed_at?: Date | null;
  winner_id?: string | null;
  player1_username?: string;
  player2_username?: string;
}

export interface SanitizedGame extends Omit<GameRecord, "game_state"> {
  game_state: GameState;
}

export interface CreateGameResponse {
  game_id: string;
  game_state: GameState;
  game_status: import("../game-engine/game.logic").GameStatus;
}

export interface UpdatedGameResponse {
  game_id: string;
  game_state: GameState;
  game_status: import("../game-engine/game.logic").GameStatus;
  winner_id: string | null;
}

// Game Rewards Service Types
export interface GameCompletionResult_Legacy {
  winner: string | null;
  final_scores: { player1: number; player2: number };
  game_duration_seconds: number;
}

export interface CurrencyRewards {
  gold: number;
  gems: number;
  fate_coins: number;
}

export interface GameRewards {
  currency: CurrencyRewards;
  card_xp_rewards: XpReward[];
}

export interface GameCompletionResult {
  game_result: GameCompletionResult_Legacy;
  rewards: GameRewards;
  updated_currencies: {
    gold: number;
    gems: number;
    fate_coins: number;
    total_xp: number;
  };
}

// XP Service Types
export interface XpReward {
  card_id: string;
  card_name: string;
  xp_gained: number;
  new_xp: number;
  new_level: number;
}

export interface XpTransferResult {
  success: boolean;
  message: string;
  transferred_xp: number;
  source_cards: { card_id: string; xp_lost: number }[];
  target_card: { card_id: string; xp_gained: number; new_level: number };
}

export interface SacrificeResult {
  success: boolean;
  message: string;
  sacrificed_cards: { card_id: string; xp_value: number }[];
  total_xp_gained: number;
  total_card_fragments_gained: number;
  pool_new_total: number;
}

export interface SacrificeExtrasResult {
  success: boolean;
  message: string;
  sacrificed_cards: {
    base_card_id: string;
    card_name: string;
    cards_sacrificed: number;
    total_xp_gained: number;
  }[];
  total_xp_gained: number;
  total_card_fragments_gained: number;
  pool_new_total: number;
}

export interface ApplyXpResult {
  success: boolean;
  message: string;
  xp_applied: number;
  new_card_xp: number;
  new_card_level: number;
  pool_remaining: number;
}

// Pack Service Types
export interface CardWithAbility {
  card_id: string;
  name: string;
  description?: string;
  rarity: Rarity;
  faction?: string;
  cost?: number;
  attack?: number;
  health?: number;
  image_url: string;
  base_power: PowerValues;
  special_ability_id: string | null;
  set_id?: string | null;
  tags: string[];
  ability_name?: string;
  ability_description?: string;
  trigger_moment?: string;
  ability_parameters?: Record<string, any>;
}

export interface PackOpenResult {
  cards: CardWithAbility[];
  gold_earned: number;
  gems_earned: number;
  fate_coins_earned: number;
}

// Mail Service Types
export interface MailFilters {
  mail_type?: string;
  is_read?: boolean;
  has_rewards?: boolean;
  sender_id?: string;
}

export interface PaginationOptions {
  page: number;
  limit: number;
  sort_by?: "created_at" | "subject";
  sort_order?: "ASC" | "DESC";
}

export interface ClaimRewardsResult {
  success: boolean;
  message: string;
  rewards_claimed?: {
    gold: number;
    gems: number;
    packs: number;
    fate_coins: number;
    cards: string[];
  };
  updated_currencies?: {
    gold: number;
    gems: number;
    pack_count: number;
    fate_coins: number;
  };
}

export interface ClaimMultipleRewardsResult {
  success: boolean;
  message: string;
  mail_processed: number;
  total_rewards?: {
    gold: number;
    gems: number;
    packs: number;
    fate_coins: number;
    cards: string[];
  };
  updated_currencies?: {
    gold: number;
    gems: number;
    pack_count: number;
    fate_coins: number;
  };
}

// Leaderboard Service Types
export interface LeaderboardResponse {
  success: boolean;
  data: Array<{
    rank: number;
    user_id: string;
    username: string;
    rating: number;
    wins: number;
    losses: number;
    draws: number;
    total_games: number;
    rank_tier: string;
    win_rate: number;
  }>;
  user_rank?: {
    rank: number;
    rating: number;
    rank_tier: string;
  };
  season: string;
  total_players: number;
}

export interface RankingStatsResponse {
  success: boolean;
  stats: {
    current_rating: number;
    peak_rating: number;
    current_rank: number;
    peak_rank: number;
    rank_tier: string;
    wins: number;
    losses: number;
    draws: number;
    total_games: number;
    win_rate: number;
    season: string;
    last_game_at?: Date;
  };
}

export interface UserRankingResponse {
  success: boolean;
  ranking: {
    current_rating: number;
    peak_rating: number;
    rank_tier: string;
    wins: number;
    losses: number;
    draws: number;
    total_games: number;
    win_rate: number;
    season: string;
  };
}

// Achievement Service Types
export interface AchievementProgressEvent {
  achievement_key: string;
  progress_value: number;
  context?: Record<string, any>;
}

export interface AchievementCompletionResult {
  completed_achievements: Achievement[];
  rewards_earned: CurrencyRewards;
}

export interface ClaimAchievementRewardsResult {
  success: boolean;
  message: string;
  rewards_claimed?: CurrencyRewards;
  updated_currencies?: {
    gold: number;
    gems: number;
    fate_coins: number;
  };
}

// Deck Service Types (consolidating from inline interfaces)
export interface DeckServiceInterface {
  deck_id: string;
  user_id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}

// Model Types (consolidating from model files)
export interface UserCreateInput {
  username: string;
  email: string;
  password_hash: string;
}

export interface SetCreateInput {
  name: string;
  description?: string;
  image_url?: string;
}

export interface CreateMailInput {
  user_id: string;
  mail_type:
    | "system"
    | "achievement"
    | "friend"
    | "admin"
    | "event"
    | "welcome"
    | "reward";
  subject: string;
  content: string;
  sender_id?: string;
  sender_name: string;
  has_rewards?: boolean;
  reward_gold?: number;
  reward_gems?: number;
  reward_packs?: number;
  reward_fate_coins?: number;
  reward_card_ids?: string[];
  expires_at?: Date;
}

// FatePick Types
export interface FatePick {
  id: string;
  user_id: string;
  card_ids: string[];
  expires_at: Date;
  created_at: Date;
  is_active: boolean;
  cost_fate_coins: number;
  tier: "common" | "uncommon" | "rare";
  participants_count: number;
  max_participants: number;
}

export interface FatePickWithDetails extends FatePick {
  cards: Array<{
    card_id: string;
    name: string;
    rarity: string;
    image_url: string;
  }>;
}

export interface FatePickParticipation {
  id: string;
  fate_pick_id: string;
  user_id: string;
  card_chosen?: string;
  participated_at: Date;
}

// Power Up Service Types
export interface ApplyPowerUpRequest {
  user_card_instance_id: string;
  power_up_data: PowerValues;
}

export interface ApplyPowerUpResult {
  success: boolean;
  message: string;
  power_up_count?: number;
  power_up_data?: PowerValues;
  error?: string;
}

export interface PowerUpValidationResult {
  isValid: boolean;
  error?: string;
  current_level?: number;
  current_power_up_count?: number;
}

// Note: RateLimitRecord and RateLimitConfig moved to middleware.types.ts
