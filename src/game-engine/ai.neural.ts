import * as fs from "fs";
import * as path from "path";
import { BoardPosition, GameState } from "../types/game.types";
import { AI_CONFIG } from "../config/constants";
import logger from "../utils/logger";
import { simulationContext } from "./simulation.context";
import { StateEncoder } from "./sim/sim.encoder";
import { ValueNet } from "./sim/sim.valueNet";
import { SearchAgent } from "./sim/sim.searchAgent";

/**
 * The live entry point for the learned-value search AI (see
 * src/game-engine/sim/ for how it is trained and evaluated).
 *
 * Every method returns null when the model can't be used — missing or
 * mismatched model files, or any error mid-search — and the caller falls back
 * to the legacy AI for that decision, so a bad model can never stall a game.
 *
 * Searches run inside simulationContext: the engine then skips achievement
 * and daily-task side effects for hypothetical moves, and skips defensive
 * state copies (events from simulated moves are discarded).
 */
const MODEL_DIR = path.join(__dirname, "../../content/ai");

let agent: SearchAgent | null = null;
let encoder: StateEncoder | null = null;
let loadFailed = false;
const reportedUnknown = new Set<string>();

function getAgent(): SearchAgent | null {
  if (agent || loadFailed) return agent;
  try {
    const cfg = AI_CONFIG.NEURAL;
    const vocab = JSON.parse(
      fs.readFileSync(path.join(MODEL_DIR, cfg.VOCAB_FILE), "utf8")
    );
    // Throws if the model was trained for a different encoder version.
    const net = ValueNet.load(path.join(MODEL_DIR, cfg.MODEL_FILE));
    encoder = new StateEncoder(vocab);
    agent = new SearchAgent(
      `neural:${cfg.MODEL_FILE}`,
      net,
      encoder,
      cfg.BREADTH,
      cfg.SAMPLES,
      "rule",
      { timeBudgetMs: cfg.TIME_BUDGET_MS, strength: cfg.STRENGTH }
    );
    logger.info("Neural AI loaded", { model: cfg.MODEL_FILE });
  } catch (error) {
    loadFailed = true;
    logger.error(
      "Neural AI failed to load; using legacy AI",
      { modelDir: MODEL_DIR },
      error instanceof Error ? error : new Error(String(error))
    );
  }
  return agent;
}

/** Logs (once each) cards the model has never seen — a cue to retrain. */
function reportUnknownCards() {
  if (!encoder) return;
  for (const key of encoder.unknown) {
    if (reportedUnknown.has(key)) continue;
    reportedUnknown.add(key);
    logger.warn("Neural AI saw a card not in its vocab; retrain to cover it", {
      card: key,
    });
  }
}

async function run<T>(what: string, fn: (a: SearchAgent) => Promise<T>) {
  const a = getAgent();
  if (!a) return null;
  try {
    return await simulationContext.withSimulation(() => fn(a));
  } catch (error) {
    logger.error(
      `Neural AI ${what} failed; using legacy AI`,
      {},
      error instanceof Error ? error : new Error(String(error))
    );
    return null;
  } finally {
    reportUnknownCards();
  }
}

export async function chooseNeuralMove(
  state: GameState,
  playerId: string
): Promise<{ user_card_instance_id: string; position: BoardPosition } | null> {
  const move = await run("move", (a) => a.chooseMove(state, playerId));
  return move
    ? { user_card_instance_id: move.cardId, position: move.position }
    : null;
}

/** Ids to select for the pending reveal-hand choice, or null to fall back. */
export async function chooseNeuralHandTargets(
  state: GameState,
  playerId: string
): Promise<string[] | null> {
  const ids = await run("hand choice", (a) =>
    a.chooseHandTargets(state, playerId)
  );
  return ids && ids.length ? ids : null;
}
