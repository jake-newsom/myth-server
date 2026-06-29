import { BoardCell, BoardPosition, GameState, InGameCard } from "./game.types";
import { PowerValues, TriggerMoment } from "./card.types";
/**
 * Game Engine specific type definitions
 * Consolidated from game-engine directory files
 */

export const COMBAT_TYPES = {
  STANDARD: "STANDARD",
  SPECIAL: "SPECIAL",
} as const;

// Game Events
export const EVENT_TYPES = {
  GAME_START: "GAME_START",
  TURN_START: "TURN_START",
  CARD_DRAWN: "CARD_DRAWN",
  CARD_DISCARDED: "CARD_DISCARDED",
  CARD_PLACED: "CARD_PLACED",
  ABILITY_TRIGGERED: "ABILITY_TRIGGERED",
  CARD_POWER_CHANGED: "CARD_POWER_CHANGED",
  CARD_FLIPPED: "CARD_FLIPPED",
  CARD_DEFENDED: "CARD_DEFENDED",
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
  FORCED_PASS: "FORCED_PASS",
} as const;

export type GameEventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

export interface BaseGameEvent {
  type: string;
  eventId: string;
  timestamp: number;
  delayAfterMs?: number;
  sourcePlayerId?: string;
  animation?: string;
  /** Asset filename/path to play when the client processes this event,
   *  stamped from the triggering ability's sound_effect (see triggerAbilities). */
  soundEffect?: string;
  position?: BoardPosition;
}

export interface CardEvent extends BaseGameEvent {
  cardId: string;
  position?: BoardPosition;
}

export interface CardPlacedEvent extends CardEvent {
  originalOwner: string;
  position: BoardPosition;
}

export interface TileEvent extends BaseGameEvent {
  position: BoardPosition;
  tile: Pick<BoardCell, "tile_enabled" | "tile_effect">;
}

export interface CardPowerChangedEvent extends CardEvent {
  type: typeof EVENT_TYPES.CARD_POWER_CHANGED;
  powerDelta: number;      // e.g., +2 or -3 (largest-magnitude side; legacy scalar)
  /**
   * Signed per-side delta for this change, e.g. {top:1,right:1,bottom:1,left:1}
   * or {left:-3}. Optional/additive: when present the client renders a caret per
   * changed side (and an "all" glyph when every side is equal) and can tick the
   * card's displayed power through this intermediate value. Omitted by emitters
   * that only know a scalar total (buff-removed/cleanse), where the client falls
   * back to `powerDelta`.
   */
  powerBySide?: Partial<PowerValues>;
  effectName?: string;     // e.g., "Blessing of Amaterasu"
  position: BoardPosition; // Required for power change events
}

export type CombatContext = TriggerContext & {
  combatType: (typeof COMBAT_TYPES)[keyof typeof COMBAT_TYPES];
};

export type CombatResolverResult = {
  preventDefeat: boolean;
  events?: BaseGameEvent[];
};

export type CombatResolverMethod = (
  context: CombatContext
) => CombatResolverResult;
export type CombatResolverMap = Record<string, CombatResolverMethod>;

export type AbilityMethod = (context: TriggerContext) => BaseGameEvent[];
export type AbilityMap = Record<string, AbilityMethod>;

// Game Status Enum
export enum GameStatus {
  PENDING = "pending",
  ACTIVE = "active",
  COMPLETED = "completed",
  ABORTED = "aborted",
  REWARDED = "rewarded",
  MULLIGAN = "mulligan",
}

export type TriggerContext = {
  state: GameState;
  triggerCard: InGameCard;
  triggerMoment: TriggerMoment;
  originalTriggerCard?: InGameCard;
  flippedCard?: InGameCard;
  flippedBy?: InGameCard;
  flippedCardId?: string;
  flippedByCardId?: string;
  position: BoardPosition;
  // Player-chosen target board position for targeted OnPlace abilities.
  // Undefined for AI/timeout plays — those abilities self-select a target.
  targetPosition?: BoardPosition;
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
