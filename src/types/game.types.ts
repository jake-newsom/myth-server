import { GameStatus } from "../game-engine/game.logic";
import { InGameCard, PowerValues } from "./card.types";
import type { SagaBattleContext } from "./sagaBattle.types";

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
  source_player_id?: string;
  source_card_id?: string;
  source_ability_id?: string;
}

export interface BoardCell {
  card: InGameCard | null;
  tile_enabled: boolean;
  tile_effect?: TileEffect;
}

export type GameBoard = Array<Array<BoardCell>>;

/**
 * Deck effect types based on mythology composition (12+ cards of same set)
 * - norse: Random card in hand gains +1 at turn start when behind
 * - polynesian: Random card in hand gains +1 when terrain is added (once per round)
 * - japanese: Random card in hand gains +1 when a card receives a curse (once per round)
 */
export type DeckEffectType = "norse" | "polynesian" | "japanese";

/**
 * Tracks round-based trigger state for deck effects
 */
export interface DeckEffectState {
  /** Last round number when the effect was triggered (for once-per-round effects) */
  last_triggered_round: number;
}

export interface Player {
  user_id: string;
  hand: string[];
  deck: string[];
  discard_pile: string[];
  score: number;
  equipped_card_back?: import("./database.types").EquippedCardBack | null;
  /** Deck passive effect based on mythology composition (12+ cards of same set) */
  deck_effect?: DeckEffectType | null;
  /** State tracking for deck effect triggers */
  deck_effect_state?: DeckEffectState;
}

export interface MulliganPlayerState {
  committed: boolean;
  replaced_count: number;
}

/**
 * The effect applied to each card the chooser selects in a reveal-hand choice.
 * Generic so different abilities can reuse the same interactive flow.
 */
export type HandChoiceEffect = {
  /** Currently only an in-hand power debuff is supported. */
  kind: "debuff";
  /** Magnitude applied to all sides of each chosen card (positive number). */
  amount: number;
  /** Effect label shown on the floating power-change indicator. */
  label: string;
  /** Optional VFX animation key. */
  animation?: string;
};

/**
 * Tracks a move that is paused mid-resolution awaiting interactive player input:
 * a generic "reveal the opponent's hand and select N card(s)" prompt. Frigg's
 * Foresight is the first user, but the shape is ability-agnostic — the prompt
 * copy, how many cards to pick, and the effect applied all come from here.
 *
 * When set, the game is frozen: no further actions resolve until the chooser
 * responds (or the turn timer times out and the server auto-resolves). It is
 * part of persisted state so a reconnect/refresh can re-derive the prompt.
 *
 * NOTE: this is sensitive — `choosable_card_ids` reveals the opponent's hand.
 * It must be stripped from the state broadcast to the non-chooser (see
 * sanitizeGameStateForPlayer) and surfaced to the chooser via a dedicated
 * SERVER_CHOICE_REQUIRED payload only.
 */
export interface PendingChoice {
  /** Discriminator for the kind of interactive prompt. */
  type: "reveal_hand_select";
  /** Player who must respond (the one who played the source card). */
  chooser_id: string;
  /** Source card's user_card_instance_id (effect source / VFX origin). */
  source_card_id: string;
  /** Source card's board tile. */
  source_position: BoardPosition;
  /** Opponent hand card ids, snapshotted when the choice was raised. */
  choosable_card_ids: string[];
  /** How many cards the chooser must select. */
  select_count: number;
  /** Title shown on the overlay (usually the skill name). */
  prompt_title: string;
  /** Short instruction shown under the title. */
  prompt_text: string;
  /** What happens to each selected card when the choice resolves. */
  effect: HandChoiceEffect;
  turn_number: number;
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
  /**
   * Counts consecutive forced passes. Incremented when a player with an empty
   * hand passes their turn. Reset to 0 when any card is successfully played.
   * When this reaches 2 (both players passed back-to-back), the game ends.
   */
  consecutive_passes?: number;
  // Cache for quick lookup of hydrated card instance details by user_card_instance_id
  hydrated_card_data_cache?: Record<string, InGameCard>;
  mulligan_state?: {
    player1: MulliganPlayerState;
    player2: MulliganPlayerState;
    deadline_ms?: number;
  };
  /** Present for Sagas mode battles (Phase 4+) */
  saga_context?: SagaBattleContext;
  /**
   * Set when a move is paused awaiting interactive player input (e.g. Frigg).
   * While present, the game is frozen until the choice resolves or times out.
   */
  pending_choice?: PendingChoice;
}

export interface GameAction {
  game_id: string;
  action_type:
    | "placeCard"
    | "endTurn"
    | "surrender"
    | "forcePass"
    | "mulligan"
    | "handChoice";
  user_card_instance_id?: string; // ID of the UserCardInstance being played
  position?: BoardPosition;
  // Player-chosen target for abilities that require selecting a board card
  // (e.g. urashima_time_shift, tawara_piercing_shot). Validated server-side.
  targetPosition?: BoardPosition;
  replaced_card_instance_ids?: string[]; // For mulligan action
  // Chosen enemy hand card(s) for an interactive reveal-hand choice (handChoice).
  chosen_card_ids?: string[];
}

export interface AbilityEffect {
  type: string;
  value?: number | string;
  duration?: number;
  condition?: string;
  target?: "self" | "opponent" | "all";
}
