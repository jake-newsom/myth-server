import { BoardPosition, DeckEffectType, GameState } from "../../types/game.types";
import { InGameCard } from "../../types/card.types";

/**
 * A deck frozen to plain data so headless games never touch the database.
 * Produced by sim/cli/export-deck-pool.ts.
 */
export interface DeckSnapshot {
  deck_id: string;
  name: string;
  source: "ai" | "player";
  deck_effect: DeckEffectType | null;
  /** Hydrated cards exactly as GameLogic.hydrateCardInstances returns them. */
  cards: InGameCard[];
}

export interface DeckPool {
  exported_at: string;
  source_db: string;
  decks: DeckSnapshot[];
}

export interface SimMove {
  cardId: string;
  position: BoardPosition;
}

/**
 * One seat's decision-maker. Every decision point in a standard 1v1 game is a
 * method here, so a learned model can replace any of them independently.
 */
export interface SimAgent {
  readonly name: string;
  /** Card instance ids (≤ MAX_MULLIGAN_REPLACEMENTS) to send back. */
  chooseMulligan(state: GameState, playerId: string): Promise<string[]>;
  /** null = no move; the runner ends the turn like the live controller does. */
  chooseMove(state: GameState, playerId: string): Promise<SimMove | null>;
  /** Answer a pending_choice (Frigg-style reveal-hand select). */
  chooseHandTargets(state: GameState, playerId: string): Promise<string[]>;
}

export type SimOutcome = "p1" | "p2" | "draw" | "error";

export interface SimGameResult {
  seed: number;
  outcome: SimOutcome;
  p1Agent: string;
  p2Agent: string;
  p1Deck: string;
  p2Deck: string;
  p1Score: number;
  p2Score: number;
  turns: number;
  durationMs: number;
  /** Total decision time per seat, for ms/move reporting. */
  decisionMs: { p1: number; p2: number };
  decisions: { p1: number; p2: number };
  handChoices: number;
  error?: string;
}
