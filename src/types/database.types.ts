import { PowerValues, Rarity, TriggerMoment } from "./card.types";

/**
 * Type definitions for database schemas
 * These will be maintained in a separate file for future packaging as an NPM module
 */

export interface User {
  user_id: string;
  username: string;
  email: string;
  password_hash: string;
  in_game_currency: number; // Legacy field - will be phased out
  gold: number;
  gems: number;
  fate_coins: number;
  total_xp: number;
  pack_count: number;
  created_at: Date;
  last_login: Date;
}

export interface UserCardXpPool {
  user_id: string;
  card_name: string;
  available_xp: number;
  total_earned_xp: number;
  created_at: Date;
  updated_at: Date;
}

export interface XpTransfer {
  id: string;
  user_id: string;
  transfer_type:
    | "card_to_card"
    | "sacrifice_to_pool"
    | "pool_to_card"
    | "game_reward_to_pool";
  source_card_ids?: string[];
  target_card_id?: string;
  card_name: string;
  xp_transferred: number;
  efficiency_rate?: number;
  created_at: Date;
}

export interface Set {
  set_id: string;
  name: string;
  description?: string;
  image_url?: string;
  is_released: boolean;
  created_at: Date;
  updated_at: Date;
}

// UserPack interface removed - packs are now tracked as a simple count on the User

export interface SpecialAbility {
  ability_id: string;
  id: string;
  name: string;
  description: string;
  triggerMoment: TriggerMoment;
  parameters: Record<string, any>;
}

export interface Card {
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
}

export interface UserCardInstance {
  user_card_instance_id: string;
  user_id: string;
  card_id: string;
  level: number;
  xp: number;
  power_enhancements: PowerValues;
  created_at?: Date;
}

export interface Deck {
  deck_id: string;
  user_id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}

export interface DeckCard {
  deck_card_id: string;
  deck_id: string;
  user_card_instance_id: string;
}

export interface Game {
  game_id: string;
  player1_id: string;
  player2_id: string;
  player1_deck_id: string;
  player2_deck_id: string;
  game_mode: "solo" | "pvp";
  winner_id: string | null;
  game_status: "pending" | "active" | "completed" | "aborted";
  game_state: Record<string, any>;
  board_layout: "4x4";
  created_at: Date;
  completed_at: Date | null;
}

export interface DeckWithCards extends Deck {
  user_card_instance_ids: string[];
}

export interface PackOpeningHistory {
  pack_opening_id: string;
  user_id: string;
  set_id: string;
  card_ids: string[];
  opened_at: Date;
}

export interface Friendship {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: "pending" | "accepted" | "rejected" | "blocked";
  created_at: Date;
  updated_at: Date;
}

export interface FriendshipWithUser extends Friendship {
  friend_username: string;
  friend_email: string;
  is_online?: boolean;
}

export interface UserRanking {
  id: string;
  user_id: string;
  season: string;
  rating: number;
  peak_rating: number;
  wins: number;
  losses: number;
  draws: number;
  current_rank?: number;
  peak_rank?: number;
  rank_tier:
    | "Bronze"
    | "Silver"
    | "Gold"
    | "Platinum"
    | "Diamond"
    | "Master"
    | "Grandmaster";
  last_game_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface UserRankingWithUser extends UserRanking {
  username: string;
  total_games: number;
  win_rate: number;
}

export interface GameResult {
  id: string;
  game_id: string;
  player1_id: string;
  player2_id: string;
  winner_id?: string;
  game_mode: string;
  game_duration_seconds: number;
  player1_rating_before: number;
  player1_rating_after: number;
  player2_rating_before: number;
  player2_rating_after: number;
  rating_change: number;
  season: string;
  completed_at: Date;
}

export interface GameResultWithPlayers extends GameResult {
  player1_username: string;
  player2_username: string;
  winner_username?: string;
}

export interface Achievement {
  id: string;
  achievement_key: string;
  title: string;
  description: string;
  category: "gameplay" | "collection" | "social" | "progression" | "special";
  type: "single" | "progress" | "milestone";
  target_value: number;
  rarity: Rarity;
  reward_gold: number;
  reward_gems: number;
  reward_packs: number;
  icon_url?: string;
  is_active: boolean;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

export interface UserAchievement {
  id: string;
  user_id: string;
  achievement_id: string;
  current_progress: number;
  is_completed: boolean;
  completed_at?: Date;
  claimed_at?: Date;
  is_claimed: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface UserAchievementWithDetails extends UserAchievement {
  achievement: Achievement;
  progress_percentage: number;
  can_claim: boolean;
}

export interface Mail {
  id: string;
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
  is_read: boolean;
  is_claimed: boolean;
  has_rewards: boolean;
  reward_gold: number;
  reward_gems: number;
  reward_packs: number;
  reward_fate_coins: number;
  reward_card_ids: string[];
  expires_at?: Date;
  read_at?: Date;
  claimed_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface MailWithSender extends Mail {
  sender_username?: string;
}

export interface MailStats {
  total_mail: number;
  unread_mail: number;
  unclaimed_rewards: number;
  expired_mail: number;
}

export interface UserCardPowerUp {
  id: string;
  user_card_instance_id: string;
  power_up_count: number;
  power_up_data: PowerValues;
  created_at: Date;
  updated_at: Date;
}
