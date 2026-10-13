import { GameState } from "../../types/game.types";
import { GAME_CONFIG } from "../../config/constants";
import { GameLogic, GameStatus } from "../game.logic";
import { chooseAIMulligan, MAX_MULLIGAN_REPLACEMENTS } from "../game.mulligan";
import * as validators from "../game.validators";
import { randomInt } from "../simulation.rng";
import { SimAgent, SimMove } from "./sim.types";
import { StateEncoder } from "./sim.encoder";
import { ValueNet } from "./sim.valueNet";

/*
 * The learned-value agents. Kept free of any AILogic import so the live AI
 * (ai.logic.ts → ai.neural.ts) can use them without an import cycle.
 */

export function legalMoves(state: GameState, playerId: string): SimMove[] {
  const player = validators.getPlayer(state, playerId);
  const moves: SimMove[] = [];
  for (let y = 0; y < GAME_CONFIG.BOARD_SIZE; y++) {
    for (let x = 0; x < GAME_CONFIG.BOARD_SIZE; x++) {
      if (!validators.canPlaceOnTile(state, { x, y }).canPlace) continue;
      for (const cardId of player.hand) {
        moves.push({ cardId, position: { x, y } });
      }
    }
  }
  return moves;
}

/**
 * One-ply search with the learned value net as the leaf evaluator: plays each
 * legal move through the real engine and keeps the one whose resulting
 * position the net rates best. Reveal-hand targets are chosen the same way,
 * by resolving each candidate and evaluating the outcome.
 */
export class ValueNetAgent implements SimAgent {
  constructor(
    readonly name: string,
    private readonly net: ValueNet,
    private readonly encoder: StateEncoder,
    /** Random-move rate for self-play data generation; 0 when evaluating. */
    private readonly epsilon = 0,
    /** "net" scores mulligan options with the model; "rule" = production heuristic. */
    private readonly mulligan: "net" | "rule" = "net"
  ) {}

  /** Net value for playerId, or the exact result if the game has ended. */
  protected value(state: GameState, playerId: string): number {
    if (state.status === GameStatus.COMPLETED) {
      return state.winner === playerId ? 1 : state.winner ? -1 : 0;
    }
    return this.net.evaluate(this.encoder.encode(state, playerId));
  }

  /** Plays a move through the engine, resolving any reveal-hand choice. */
  protected async play(
    state: GameState,
    playerId: string,
    move: SimMove,
    bestTargets: boolean
  ): Promise<GameState | null> {
    try {
      let { state: next } = await GameLogic.placeCard(
        state,
        playerId,
        move.cardId,
        move.position
      );
      if (next.pending_choice) {
        next = bestTargets
          ? await this.resolveBestChoice(next, playerId)
          : await this.resolveStrongestChoice(next);
      }
      return next;
    } catch {
      // Illegal for a reason canPlaceOnTile doesn't see; skip it.
      return null;
    }
  }

  /**
   * Tries every legal mulligan (keep all, or replace any 1–2 cards) and keeps
   * the one whose opening position the net rates best, averaged over
   * MULLIGAN_SAMPLES random replacement draws. The real deck order is never
   * read: each sample reshuffles the deck before drawing, so this is the
   * same information a player has.
   */
  async chooseMulligan(state: GameState, playerId: string) {
    if (this.mulligan === "rule") return chooseAIMulligan(state, playerId);

    const key = state.player1.user_id === playerId ? "player1" : "player2";
    const player = state[key];
    let best: string[] = [];
    let bestValue = -Infinity;
    for (const replaced of mulliganOptions(player.hand)) {
      const samples = replaced.length ? MULLIGAN_SAMPLES : 1;
      let total = 0;
      for (let s = 0; s < samples; s++) {
        const deck = shuffled([...player.deck]);
        const kept = player.hand.filter((id) => !replaced.includes(id));
        const drawn = deck.splice(0, replaced.length);
        const world: GameState = {
          ...state,
          [key]: {
            ...player,
            hand: [...kept, ...drawn],
            deck: [...deck, ...replaced],
          },
        };
        total += this.value(world, playerId);
      }
      const v = total / samples;
      if (v > bestValue) {
        bestValue = v;
        best = replaced;
      }
    }
    return best;
  }

  async chooseMove(state: GameState, playerId: string) {
    const moves = legalMoves(state, playerId);
    if (this.epsilon > 0 && moves.length && randomInt(1000) < this.epsilon * 1000) {
      return moves[randomInt(moves.length)];
    }
    const scored = await this.scoreMoves(state, playerId, moves);
    return scored.length ? scored[0].move : null;
  }

  /** One-ply scores, best first, keeping each resulting state. */
  protected async scoreMoves(state: GameState, playerId: string, moves: SimMove[]) {
    const scored: { move: SimMove; next: GameState; v: number }[] = [];
    for (const move of moves) {
      const next = await this.play(state, playerId, move, true);
      if (!next) continue;
      scored.push({ move, next, v: this.value(next, playerId) + randomInt(100) / 1e6 });
    }
    return scored.sort((a, b) => b.v - a.v);
  }

  async chooseHandTargets(state: GameState, playerId: string) {
    return (await this.bestChoice(state, playerId)).ids;
  }

  private async resolveBestChoice(state: GameState, playerId: string) {
    const { next } = await this.bestChoice(state, playerId);
    return next ?? { ...state, pending_choice: undefined };
  }

  /** Cheap choice for searched opponent replies: production's heuristic. */
  private async resolveStrongestChoice(state: GameState) {
    const ids = GameLogic.pickStrongestPendingChoiceCards(state);
    return ids.length
      ? (await GameLogic.resolveHandChoice(state, ids)).state
      : { ...state, pending_choice: undefined };
  }

  private async bestChoice(state: GameState, playerId: string) {
    const pending = state.pending_choice;
    let best: { ids: string[]; next: GameState | null; v: number } = {
      ids: [],
      next: null,
      v: -Infinity,
    };
    if (!pending) return best;
    // Every live reveal-hand ability selects one card; for larger selections
    // fall back to the strongest-cards heuristic rather than enumerate combos.
    const options =
      pending.select_count === 1
        ? pending.choosable_card_ids.map((id) => [id])
        : [GameLogic.pickStrongestPendingChoiceCards(state)];
    for (const ids of options) {
      const { state: next } = await GameLogic.resolveHandChoice(state, ids);
      const v = this.value(next, playerId);
      if (v > best.v) best = { ids, next, v };
    }
    return best;
  }
}

/**
 * Two-ply search: shortlists the top `breadth` moves by one-ply value, then
 * scores each by the opponent's best reply (min over replies), averaged over
 * `samples` determinizations of the opponent's hidden hand. The opponent's
 * real hand is never read: each sample deals a hand of the same size from the
 * cards they haven't played yet (hand + deck).
 */
export class SearchAgent extends ValueNetAgent {
  constructor(
    name: string,
    net: ValueNet,
    encoder: StateEncoder,
    private readonly breadth = 6,
    private readonly samples = 3,
    mulligan: "net" | "rule" = "net",
    private readonly opts: SearchOptions = {}
  ) {
    super(name, net, encoder, 0, mulligan);
  }

  async chooseMove(state: GameState, playerId: string) {
    const deadline = Date.now() + (this.opts.timeBudgetMs ?? Infinity);
    const shortlist = (
      await this.scoreMoves(state, playerId, legalMoves(state, playerId))
    ).slice(0, this.breadth);
    if (shortlist.length <= 1) return shortlist[0]?.move ?? null;

    // Strength < 1: sometimes play a random shortlisted move instead of the
    // best one. Shortlisted moves are all reasonable, so a weaker AI still
    // plays sensibly rather than throwing games.
    const strength = this.opts.strength ?? 1;
    if (strength < 1 && randomInt(1000) >= strength * 1000) {
      return shortlist[randomInt(shortlist.length)].move;
    }

    // Candidates are searched best-first, so running out of time just means
    // the remaining (one-ply-worse) candidates go unsearched.
    let best = shortlist[0];
    let bestScore = -Infinity;
    for (const candidate of shortlist) {
      if (Date.now() > deadline) break;
      let total = 0;
      for (let s = 0; s < this.samples; s++) {
        total += await this.worstReply(candidate.next, playerId);
      }
      const score = total / this.samples;
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return best.move;
  }

  /** Value for me after the opponent's best reply in one sampled world. */
  private async worstReply(state: GameState, me: string): Promise<number> {
    if (state.status !== GameStatus.ACTIVE) return this.value(state, me);
    const oppId = state.current_player_id;
    if (oppId === me) return this.value(state, me);

    const world = dealHiddenHand(state, oppId);
    const opp = validators.getPlayer(world, oppId);
    if (!validators.canPlayerPlay(opp)) return this.value(world, me);

    let worst = Infinity;
    for (const reply of legalMoves(world, oppId)) {
      const after = await this.play(world, oppId, reply, false);
      if (!after) continue;
      worst = Math.min(worst, this.value(after, me));
    }
    return worst === Infinity ? this.value(world, me) : worst;
  }
}

const MULLIGAN_SAMPLES = 6;

/** Every subset of the hand of size 0..MAX_MULLIGAN_REPLACEMENTS (≤ 2). */
function mulliganOptions(hand: string[]): string[][] {
  const options: string[][] = [[]];
  for (let i = 0; i < hand.length; i++) {
    options.push([hand[i]]);
    if (MAX_MULLIGAN_REPLACEMENTS < 2) continue;
    for (let j = i + 1; j < hand.length; j++) options.push([hand[i], hand[j]]);
  }
  return options;
}

function shuffled<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export interface SearchOptions {
  /** Stop searching further candidates once this much time has passed. */
  timeBudgetMs?: number;
  /** 0..1 — chance of playing the searched-best move (1 = full strength). */
  strength?: number;
}

/** Re-deals a player's hand from their unseen cards (hand + deck), same size. */
function dealHiddenHand(state: GameState, playerId: string): GameState {
  const world = { ...state };
  const key = state.player1.user_id === playerId ? "player1" : "player2";
  const player = state[key];
  const unseen = shuffled([...player.hand, ...player.deck]);
  world[key] = {
    ...player,
    hand: unseen.slice(0, player.hand.length),
    deck: unseen.slice(player.hand.length),
  };
  return world;
}
