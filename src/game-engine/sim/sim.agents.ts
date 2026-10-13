import { GameState } from "../../types/game.types";
import { GAME_CONFIG } from "../../config/constants";
import { AILogic } from "../ai.logic";
import { GameLogic, GameStatus } from "../game.logic";
import { chooseAIMulligan } from "../game.mulligan";
import * as validators from "../game.validators";
import { randomInt } from "../simulation.rng";
import * as fs from "fs";
import { SimAgent, SimMove } from "./sim.types";
import { StateEncoder } from "./sim.encoder";
import { ValueNet } from "./sim.valueNet";

function legalMoves(state: GameState, playerId: string): SimMove[] {
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

/** The production AI, exactly as the live controller drives it. */
export class CurrentAIAgent implements SimAgent {
  readonly name = "current";
  private readonly ai = new AILogic();

  async chooseMulligan(state: GameState, playerId: string) {
    return chooseAIMulligan(state, playerId);
  }

  async chooseMove(state: GameState, playerId: string) {
    const move = await this.ai.makeAIMove(state, "hard", playerId);
    return move
      ? { cardId: move.user_card_instance_id, position: move.position }
      : null;
  }

  async chooseHandTargets(state: GameState) {
    return GameLogic.pickStrongestPendingChoiceCards(state);
  }
}

/**
 * Uniform random legal play. Uses the simulation RNG, so it is reproducible
 * under the game's seed. Sanity floor: any real agent must crush this.
 */
export class RandomAgent implements SimAgent {
  readonly name = "random";

  async chooseMulligan() {
    return [];
  }

  async chooseMove(state: GameState, playerId: string) {
    const moves = legalMoves(state, playerId);
    return moves.length ? moves[randomInt(moves.length)] : null;
  }

  async chooseHandTargets(state: GameState) {
    const pending = state.pending_choice;
    if (!pending) return [];
    const pool = [...pending.choosable_card_ids];
    const picked: string[] = [];
    while (picked.length < pending.select_count && pool.length) {
      picked.push(pool.splice(randomInt(pool.length), 1)[0]);
    }
    return picked;
  }
}

/**
 * One-ply greedy: plays the move that maximises its immediate board-ownership
 * lead after the engine fully resolves it (abilities, flips, everything).
 * A useful middle rung between random and the search AI.
 */
export class GreedyAgent implements SimAgent {
  /**
   * @param epsilon chance of playing a uniformly random move instead. Used for
   *   self-play data, so the value net sees positions greedy would never reach.
   */
  constructor(
    readonly name = "greedy",
    private readonly epsilon = 0
  ) {}

  async chooseMulligan(state: GameState, playerId: string) {
    return chooseAIMulligan(state, playerId);
  }

  async chooseMove(state: GameState, playerId: string) {
    const moves = legalMoves(state, playerId);
    if (this.epsilon > 0 && moves.length && randomInt(1000) < this.epsilon * 1000) {
      return moves[randomInt(moves.length)];
    }
    let best: SimMove | null = null;
    let bestScore = -Infinity;
    for (const move of moves) {
      try {
        const { state: next } = await GameLogic.placeCard(
          state,
          playerId,
          move.cardId,
          move.position
        );
        const score = boardLead(next, playerId) + randomInt(100) / 1000;
        if (score > bestScore) {
          bestScore = score;
          best = move;
        }
      } catch {
        // Illegal for a reason canPlaceOnTile doesn't see; skip it.
      }
    }
    return best;
  }

  async chooseHandTargets(state: GameState) {
    return GameLogic.pickStrongestPendingChoiceCards(state);
  }
}

function boardLead(state: GameState, playerId: string): number {
  let lead = 0;
  for (const row of state.board) {
    for (const cell of row) {
      if (!cell.card) continue;
      lead += cell.card.owner === playerId ? 1 : -1;
    }
  }
  return lead;
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
    private readonly epsilon = 0
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

  async chooseMulligan(state: GameState, playerId: string) {
    return chooseAIMulligan(state, playerId);
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
    private readonly samples = 3
  ) {
    super(name, net, encoder);
  }

  async chooseMove(state: GameState, playerId: string) {
    const shortlist = (
      await this.scoreMoves(state, playerId, legalMoves(state, playerId))
    ).slice(0, this.breadth);
    if (shortlist.length <= 1) return shortlist[0]?.move ?? null;

    let best = shortlist[0];
    let bestScore = -Infinity;
    for (const candidate of shortlist) {
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

/** Re-deals a player's hand from their unseen cards (hand + deck), same size. */
function dealHiddenHand(state: GameState, playerId: string): GameState {
  const world = { ...state };
  const key = state.player1.user_id === playerId ? "player1" : "player2";
  const player = state[key];
  const unseen = [...player.hand, ...player.deck];
  for (let i = unseen.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [unseen[i], unseen[j]] = [unseen[j], unseen[i]];
  }
  world[key] = {
    ...player,
    hand: unseen.slice(0, player.hand.length),
    deck: unseen.slice(player.hand.length),
  };
  return world;
}

/**
 * "value[-eps][:<model>]" → one-ply ValueNetAgent;
 * "search[:<model>]" → two-ply SearchAgent.
 */
function loadValueAgent(spec: string): SimAgent {
  const [kind, modelPath = ".ai-sim/models/value-v1.json"] = spec.split(":");
  const vocab = JSON.parse(fs.readFileSync(".ai-sim/vocab.json", "utf8"));
  const net = ValueNet.load(modelPath);
  const encoder = new StateEncoder(vocab);
  if (kind === "search") return new SearchAgent(spec, net, encoder);
  return new ValueNetAgent(spec, net, encoder, kind === "value-eps" ? 0.15 : 0);
}

export const AGENTS: Record<string, () => SimAgent> = {
  current: () => new CurrentAIAgent(),
  random: () => new RandomAgent(),
  greedy: () => new GreedyAgent(),
  "greedy-eps": () => new GreedyAgent("greedy-eps", 0.15),
};

export function createAgent(name: string): SimAgent {
  if (name.startsWith("value") || name.startsWith("search")) {
    return loadValueAgent(name);
  }
  const factory = AGENTS[name];
  if (!factory) {
    throw new Error(
      `Unknown agent "${name}". Known: ${Object.keys(AGENTS).join(", ")}`
    );
  }
  return factory();
}
