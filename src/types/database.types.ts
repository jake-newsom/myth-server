/**
 * Type definitions for database schemas
 * These will be maintained in a separate file for future packaging as an NPM module
 */

export interface User {
  user_id: string;
  username: string;
  email: string;
  password_hash: string;
  in_game_currency: number;
  created_at: Date;
  last_login: Date;
}

export interface SpecialAbility {
  ability_id: string;
  id: string;
  name: string;
  description: string;
  triggerMoment:
    | "OnPlace"
    | "OnFlip"
    | "OnFlipped"
    | "OnTurnStart"
    | "OnTurnEnd";
  parameters: Record<string, any>;
}

export interface Card {
  card_id: string;
  name: string;
  description: string;
  rarity: string;
  card_type: string;
  faction: string;
  cost: number;
  attack?: number;
  health?: number;
  image_url?: string;
}

export interface UserCardInstance {
  user_card_instance_id: string;
  user_id: string;
  card_id: string;
  level: number;
  xp: number;
  created_at: Date;
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
