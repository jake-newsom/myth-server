import { Card as BaseCard, SpecialAbility } from "./database.types"; // Assuming BaseCard is from database.types

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

export interface BoardCell {
  user_card_instance_id: string; // ID of the specific UserCardInstance on the board
  base_card_id: string; // ID of the base card definition
  owner: string; // user_id of the player who owns this card on board
  currentPower: CardPower; // Actual power of the card instance on the board (base + level bonus)
  level: number; // Level of the card instance
  state: CardState;
  // Store base card details directly for easy access by abilities/combat without constant lookups
  baseCardData: {
    name: string;
    rarity: string;
    image_url: string;
    special_ability_id: string | null;
    tags: string[];
    // Base power is used to calculate currentPower with level
    basePower: CardPower;
    // Ability details directly on the cell for easier processing
    ability_name?: string | null;
    ability_description?: string | null;
    ability_triggerMoment?: string | null;
    ability_parameters?: Record<string, any> | null;
  };
}

export type GameBoard = Array<Array<BoardCell | null>>;

// Represents details of a card instance needed during gameplay (hand, deck, board)
export interface HydratedCardInstance {
  user_card_instance_id: string;
  base_card_id: string;
  name: string;
  rarity: string;
  image_url: string;
  currentPower: CardPower; // Derived power based on level
  basePower: CardPower; // Original power from base card definition
  level: number;
  xp: number;
  tags: string[];
  special_ability_id: string | null;
  ability_name?: string | null;
  ability_description?: string | null;
  ability_triggerMoment?: string | null;
  ability_parameters?: Record<string, any> | null;
}

export interface Player {
  userId: string;
  hand: string[]; // Array of user_card_instance_id
  deck: string[]; // Array of user_card_instance_id
  score: number;
}

export interface GameState {
  board: GameBoard;
  player1: Player;
  player2: Player;
  currentPlayerId: string;
  turnNumber: number;
  status:
    | "pending"
    | "active"
    | "completed"
    | "aborted"
    | "player1_win"
    | "player2_win"
    | "draw";
  maxCardsInHand: number;
  initialCardsToDraw: number;
  winner?: string | null;
  // Cache for quick lookup of hydrated card instance details by user_card_instance_id
  hydratedCardDataCache?: Record<string, HydratedCardInstance>;
}

export interface GameAction {
  gameId: string;
  actionType: "placeCard" | "endTurn" | "surrender";
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
