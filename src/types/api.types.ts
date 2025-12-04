import { PowerValues, Rarity, TriggerMoment } from "./card.types";
import { Request } from "express";

/**
 * Type definitions for API requests and responses
 * These will be maintained in a separate file for future packaging as an NPM module
 */

// Authentication types
export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: {
    user_id: string;
    username: string;
    email: string;
    in_game_currency: number;
  };
}

// Error response types moved to middleware.types.ts

// User profile types
export interface UserProfile {
  user_id: string;
  username: string;
  email: string;
  in_game_currency: number; // Legacy field
  gold: number;
  gems: number;
  fate_coins: number;
  card_fragments: number;
  total_xp: number;
  pack_count: number;
  created_at: string; // ISO Date string
  last_login_at: string; // ISO Date string
}

// Card types for API responses
export interface CardResponse {
  user_card_instance_id?: string;
  base_card_id: string;
  name: string;
  rarity: Rarity;
  image_url: string;
  base_power: PowerValues;
  level?: number;
  xp?: number;
  tags: string[];
  set_id: string | null;
  special_ability: {
    ability_id: string;
    name: string;
    description: string;
    triggerMoments: TriggerMoment[];
    parameters: Record<string, any>;
  } | null;
  power_enhancements?: PowerValues;
  attackAnimation?: string; // Custom attack animation for card flips
}

export interface StaticCardCollectionResponse {
  data: CardResponse[];
  total: number;
  page: number;
  limit: number;
}

// Deck types
export interface DeckSummary {
  deck_id: string;
  name: string;
  created_at: string;
  last_updated: string;
  card_count: number;
}

export interface DeckDetailResponse {
  deck_id: string;
  name: string;
  user_id: string;
  created_at: string;
  last_updated: string;
  cards: CardResponse[];
}

export interface CreateDeckRequest {
  name: string;
  user_card_instance_ids: string[]; // Array of UserCardInstance IDs
}

export interface UpdateDeckRequest {
  name?: string;
  user_card_instance_ids?: string[]; // Array of UserCardInstance IDs
}

// Monthly Login Rewards API Types
export interface MonthlyLoginStatusResponse {
  month_year: string; // Format: YYYY-MM
  current_day: number; // Current highest day reached (0-24)
  claimed_days: number[]; // Array of claimed day numbers
  available_days: number[]; // Array of days that can be claimed (up to current_day)
  rewards: Array<{
    day: number;
    reward_type: "gems" | "fate_coins" | "card_fragments" | "card_pack" | "enhanced_card";
    amount: number;
    is_claimed: boolean;
    can_claim: boolean;
  }>;
}

// No request body needed - endpoint automatically claims next available day

export interface ClaimMonthlyRewardResponse {
  success: boolean;
  message: string;
  reward: {
    day: number;
    reward_type: "gems" | "fate_coins" | "card_fragments" | "card_pack" | "enhanced_card";
    amount: number;
    card_id?: string; // user_card_instance_id for enhanced_card rewards
  };
  updated_progress: {
    current_day: number;
    claimed_days: number[];
  };
}

// AuthenticatedRequest moved to middleware.types.ts
