import { GameState } from "../../types/game.types";
import { AILogic } from "../ai.logic";
import { GameLogic } from "../game.logic";
import { chooseAIMulligan } from "../game.mulligan";
import { randomInt } from "../simulation.rng";
import * as fs from "fs";
import { SimAgent, SimMove } from "./sim.types";
import { StateEncoder } from "./sim.encoder";
import { ValueNet } from "./sim.valueNet";
import { legalMoves, SearchAgent, ValueNetAgent } from "./sim.searchAgent";


/** The legacy rules/lookahead AI (the live AI before the neural search). */
export class CurrentAIAgent implements SimAgent {
  readonly name = "current";
  private readonly ai = new AILogic();

  async chooseMulligan(state: GameState, playerId: string) {
    return chooseAIMulligan(state, playerId);
  }

  async chooseMove(state: GameState, playerId: string) {
    // Legacy explicitly: makeAIMove now routes to the neural AI first.
    const move = await this.ai.makeLegacyAIMove(state, "hard", playerId);
    return move
      ? { cardId: move.user_card_instance_id, position: move.position }
      : null;
  }

  async chooseHandTargets(state: GameState) {
    return GameLogic.pickStrongestPendingChoiceCards(state);
  }
}

/**
 * The live AI exactly as the server runs it: AILogic.makeAIMove (neural
 * search from content/ai/, legacy fallback) and AILogic.chooseHandTargets.
 */
export class LiveAIAgent implements SimAgent {
  readonly name = "live";
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
    return this.ai.chooseHandTargets(state);
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
 * "value[-eps][:<model>]" → one-ply ValueNetAgent;
 * "search[:<model>[:<breadth>[:<samples>[:net|rule]]]]" → two-ply SearchAgent.
 * The last field picks the mulligan (default net); value agents read it from
 * the same 5th position, e.g. "value:<model>:::rule".
 */
function loadValueAgent(spec: string): SimAgent {
  const [kind, model, breadth, samples, mulligan] = spec.split(":");
  const mulliganMode = mulligan === "rule" ? "rule" : "net";
  const modelPath = model || ".ai-sim/models/value-v1.json";
  const vocab = JSON.parse(fs.readFileSync(".ai-sim/vocab.json", "utf8"));
  const net = ValueNet.load(modelPath);
  const encoder = new StateEncoder(vocab);
  if (kind === "search") {
    return new SearchAgent(
      spec,
      net,
      encoder,
      breadth ? parseInt(breadth, 10) : undefined,
      samples ? parseInt(samples, 10) : undefined,
      mulliganMode
    );
  }
  return new ValueNetAgent(
    spec,
    net,
    encoder,
    kind === "value-eps" ? 0.15 : 0,
    mulliganMode
  );
}

export const AGENTS: Record<string, () => SimAgent> = {
  current: () => new CurrentAIAgent(),
  live: () => new LiveAIAgent(),
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
