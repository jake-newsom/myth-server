/**
 * Infinite Tower Types and Interfaces
 */

import { TowerModifier, normalizeModifiers } from "./towerModifier.types";

// Tower reward tiers based on floor divisibility
export type TowerTier = "E" | "D" | "C" | "B" | "A" | "S";

/**
 * Reward structure for a tower floor
 * Calculated formulaically based on floor number
 */
export type TowerReward = {
  floor: number;
  band: number; // band 0 = floors 1-10, band 1 = 11-20, etc.
  tier: TowerTier;
  reward_gems: number;
  reward_packs: number;
  reward_card_fragments: number;
  reward_rare_art_card: number; // 0 or 1 - variant card with rare/epic/legendary base
  reward_legendary_card: number; // 0 or 1 - at floor % 500
  reward_epic_card: number; // 0 or 1 - at floor % 250
  reward_card_back?: boolean; // true at floors 100/200/300/400
};

/**
 * Tower floor configuration stored in database
 */
export interface TowerFloor {
  floor_number: number;
  name: string;
  ai_deck_id: string;
  is_active: boolean;
  average_card_level?: number; // Average level of cards in the AI deck
  created_at?: Date;
  /**
   * Encounter modifiers, max 2. Omitted entirely when the
   * `tower-encounter-modifiers` flag is off, so old clients see today's shape.
   */
  modifiers?: TowerModifier[];
}

/**
 * User's tower progress
 */
export interface TowerProgress {
  current_floor: number; // The floor user needs to beat next
  highest_completed: number; // current_floor - 1
}

/**
 * Tower floor with preview card information
 */
export interface TowerFloorWithPreview extends TowerFloor {
  preview_cards?: string[]; // Top 3 card_ids from AI deck
  reward_preview?: TowerReward;
}

/**
 * Response when starting a tower game
 */
export interface TowerGameStartResponse {
  game_id: string;
  floor_number: number;
  floor_name: string;
  opponent_mythology?: string | null; // The dominant mythology/set of the AI deck (for theming)
  ai_deck_preview?: {
    name: string;
    card_count: number;
  };
  /**
   * The floor's active modifiers, so GameView can render them without a second
   * fetch (the tower store may be empty on a direct game-screen reload).
   */
  modifiers?: TowerModifier[];
}

/**
 * Result of completing a tower floor
 */
export interface AwardedCardBack {
  back_id: string;
  name: string;
  image_url: string;
}

export interface TowerCompletionResult {
  success: boolean;
  won: boolean;
  floor_number: number;
  rewards_earned?: TowerReward;
  cards_awarded?: {
    rare_art_card?: AwardedCard;
    legendary_card?: AwardedCard;
    epic_card?: AwardedCard;
  };
  card_back_awarded?: AwardedCardBack;
  new_floor?: number; // New current floor after winning
  generation_triggered?: boolean; // Whether new floor generation was triggered
}

/**
 * Awarded card information
 */
export interface AwardedCard {
  user_card_instance_id: string;
  card_id: string;
  name: string;
  rarity: string;
  image_url?: string;
}

/**
 * Request to start a tower game
 */
export interface TowerGameStartRequest {
  player_deck_id: string;
}

/**
 * Tower list response
 */
export interface TowerListResponse {
  current_floor: number;
  floors: TowerFloorWithPreview[];
  max_available_floor: number;
}

/**
 * Generated floor data from Gemini AI
 */
export interface GeneratedFloorDeck {
  floor_number: number;
  floor_name: string; // Creative name for the floor (e.g., "The Frozen Wastes")
  deck_name: string; // Name for the AI deck
  cards: GeneratedDeckCard[];
  average_card_level?: number; // Calculated average level of cards in deck
  /** Encounter modifiers, already sanitized against the catalog. */
  modifiers?: TowerModifier[];
}

/**
 * Card in a generated deck
 */
export interface GeneratedDeckCard {
  card_name: string;
  level: number; // No cap, scales infinitely
  power_ups?: {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
}

/**
 * Card data for Gemini prompt
 */
export interface CardDataForGeneration {
  card_id: string;
  name: string;
  rarity: string;
  base_power: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  special_ability?: {
    name: string;
    description: string;
  };
}

/**
 * Reference deck data for Gemini prompt
 */
export interface ReferenceDeckData {
  floor_number: number;
  cards: {
    name: string;
    level: number;
    effective_power: {
      top: number;
      right: number;
      bottom: number;
      left: number;
    };
  }[];
  average_power: number;
}

/**
 * Database row types
 */
export interface TowerFloorRow {
  floor_number: number;
  name: string;
  ai_deck_id: string;
  is_active: boolean;
  average_card_level?: number;
  created_at: string;
  /** JSONB column; untrusted until run through normalizeModifiers. */
  modifiers?: unknown;
}

/**
 * Convert database row to TowerFloor
 */
/**
 * @param includeModifiers - only true when the `tower-encounter-modifiers` flag
 *   is on for the requesting user. When false the key is left off the object
 *   entirely (not set to []), so the serialized response is identical to the
 *   pre-modifiers shape.
 */
export function rowToTowerFloor(
  row: TowerFloorRow,
  includeModifiers = false
): TowerFloor {
  const floor: TowerFloor = {
    floor_number: row.floor_number,
    name: row.name,
    ai_deck_id: row.ai_deck_id,
    is_active: row.is_active,
    average_card_level: row.average_card_level,
    created_at: row.created_at ? new Date(row.created_at) : undefined,
  };

  if (includeModifiers) {
    floor.modifiers = normalizeModifiers(row.modifiers);
  }

  return floor;
}

