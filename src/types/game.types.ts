import { GameStatus } from "../game-engine/game.logic";
import { InGameCard, PowerValues } from "./card.types";

// Re-export InGameCard for use in other modules
export { InGameCard };

/**
 * Type definitions for game engine and related components
 */

export type BoardPosition = { x: number; y: number };

export type CardPower = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type CardState = "normal" | "immune" | "buffed" | "debuffed";

export enum TileStatus {
  Blocked = "blocked",
  Removed = "removed",
  Boosted = "boosted",
  Cursed = "cursed",
  Normal = "normal",
}

export enum TileTerrain {
  Ocean = "ocean",
  Lava = "lava",
}

export interface TileEffect {
  status: TileStatus;
  turns_left: number;
  power?: Partial<PowerValues>;
  effect_duration?: number;
  terrain?: TileTerrain;
  animation_label?: string;
  applies_to_user?: string;
}

export interface BoardCell {
  card: InGameCard | null;
  tile_enabled: boolean;
  tile_effect?: TileEffect;
}

export type GameBoard = Array<Array<BoardCell>>;

export interface Player {
  user_id: string;
  hand: string[];
  deck: string[];
  discard_pile: string[];
  score: number;
}

export interface GameState {
  board: GameBoard;
  player1: Player;
  player2: Player;
  current_player_id: string;
  turn_number: number;
  status: GameStatus;
  max_cards_in_hand: number;
  initial_cards_to_draw: number;
  winner: string | null;
  // Cache for quick lookup of hydrated card instance details by user_card_instance_id
  hydrated_card_data_cache?: Record<string, InGameCard>;
}

export interface GameAction {
  game_id: string;
  action_type: "placeCard" | "endTurn" | "surrender";
  user_card_instance_id?: string; // ID of the UserCardInstance being played
  position?: BoardPosition;
}

export interface AbilityEffect {
  type: string;
  value?: number | string;
  duration?: number;
  condition?: string;
  target?: "self" | "opponent" | "all";
}
