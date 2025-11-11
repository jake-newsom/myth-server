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

// AuthenticatedRequest moved to middleware.types.ts
