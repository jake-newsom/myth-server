import { PowerValues } from "./card.types";
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
  total_xp: number;
  pack_count: number;
  created_at: string; // ISO Date string
  last_login_at: string; // ISO Date string
}

// Card types for API responses
export interface CardResponse {
  // Represents a card instance with its current (possibly leveled) stats
  user_card_instance_id?: string; // Present if it's a user's specific instance
  base_card_id: string; // ID of the base card definition
  name: string;
  rarity: "common" | "uncommon" | "rare" | "epic" | "legendary";
  image_url: string;
  base_power: PowerValues; // Changed from 'power'
  level?: number; // Present for user instances
  xp?: number; // Present for user instances
  tags: string[];
  special_ability: {
    ability_id: string;
    name: string;
    description: string;
    triggerMoment: string;
    parameters: Record<string, any>;
  } | null;
  power_enhancements?: PowerValues; // Added for player-owned cards
}

export interface StaticCardCollectionResponse {
  // For /api/cards (list of base cards)
  data: CardResponse[]; // Here, CardResponse will not have user_card_instance_id, level, xp
  total: number;
  page: number;
  limit: number;
}

// Deck types
export interface DeckSummary {
  // For listing multiple decks
  deck_id: string;
  name: string;
  created_at: string; // ISO Date string
  last_updated: string; // ISO Date string
  card_count: number; // Total number of card instances in the deck
}

export interface DeckDetailResponse {
  // For a single deck view
  deck_id: string;
  name: string;
  user_id: string;
  created_at: string; // ISO Date string
  last_updated: string; // ISO Date string
  cards: CardResponse[]; // Array of detailed card instances in the deck
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
