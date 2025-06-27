import { BoardPosition, InGameCard } from "./game.types";

/**
 * Game Engine specific type definitions
 * Consolidated from game-engine directory files
 */

// Game Events
export const EVENT_TYPES = {
  GAME_START: "GAME_START",
  TURN_START: "TURN_START",
  CARD_DRAWN: "CARD_DRAWN",
  CARD_PLACED: "CARD_PLACED",
  ABILITY_TRIGGERED: "ABILITY_TRIGGERED",
  CARD_POWER_CHANGED: "CARD_POWER_CHANGED",
  CARD_FLIPPED: "CARD_FLIPPED",
  TILE_STATE_CHANGED: "TILE_STATE_CHANGED",
  CARD_STATE_CHANGED: "CARD_STATE_CHANGED",
  SCORE_UPDATED: "SCORE_UPDATED",
  TURN_END: "TURN_END",
  GAME_OVER: "GAME_OVER",
  ERROR_MESSAGE: "ERROR_MESSAGE",
  STATUS_EFFECT_APPLIED: "STATUS_EFFECT_APPLIED",
  STATUS_EFFECT_REMOVED: "STATUS_EFFECT_REMOVED",
  CARD_MOVED: "CARD_MOVED",
  CARD_REMOVED_FROM_BOARD: "CARD_REMOVED_FROM_BOARD",
  CARD_REMOVED_FROM_HAND: "CARD_REMOVED_FROM_HAND",
} as const;

export type GameEventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

export interface BaseGameEvent {
  type: string;
  eventId: string;
  timestamp: number;
  delayAfterMs?: number;
  sourcePlayerId?: string;
  animation?: string;
}

export interface CardEvent extends BaseGameEvent {
  cardId: string;
}

export interface CardPlacedEvent extends CardEvent {
  originalOwner: string;
  position: BoardPosition;
}

export interface TileEvent extends BaseGameEvent {
  position: BoardPosition;
  tile: Pick<
    import("./game.types").BoardCell,
    "tile_status" | "turns_left" | "animation_label"
  >;
}

// Game Status Enum
export enum GameStatus {
  PENDING = "pending",
  ACTIVE = "active",
  COMPLETED = "completed",
  ABORTED = "aborted",
}

// Game Utils Types
export type TriggerContext = {
  gameState: import("./game.types").GameState;
  triggerCard: InGameCard;
  position: BoardPosition;
  player: import("./game.types").Player;
  opponent: import("./game.types").Player;
  events: BaseGameEvent[];
};

// Utility Functions
export function batchEvents(
  events: BaseGameEvent[],
  delay: number
): BaseGameEvent[] {
  if (events.length > 0) {
    events[events.length - 1].delayAfterMs = delay;
  }
  return events;
}
