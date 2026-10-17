import os from "os";
import path from "path";
import { Worker } from "worker_threads";
import { GameState, BoardPosition } from "../types/game.types";
import { AILogic } from "./ai.logic";
import logger from "../utils/logger";
import type { AIWorkerRequest, AIWorkerResponse } from "./ai.worker";

/*
 * Runs AI decisions on worker threads so a ~1s search never blocks the main
 * event loop. Any worker failure (crash, timeout, uncloneable state) falls
 * back to running the same AILogic inline — an AI turn never gets stuck.
 */

type AIMove = {
  action_type: string;
  user_card_instance_id: string;
  position: BoardPosition;
} | null;

/** Generous: search budget is ~1s; this only catches a wedged worker. */
const REQUEST_TIMEOUT_MS = 15_000;
const POOL_SIZE = Math.max(1, Math.min(2, os.availableParallelism() - 1));

// Omit distributed over the union so each kind keeps its own fields.
type AIWorkerRequestBody = AIWorkerRequest extends infer R
  ? R extends unknown
    ? Omit<R, "id">
    : never
  : never;

type Pending = {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
};

class AIWorkerSlot {
  private worker: Worker | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;

  get load(): number {
    return this.pending.size;
  }

  private spawn(): Worker {
    const isTs = __filename.endsWith(".ts");
    const entry = path.join(__dirname, `ai.worker.${isTs ? "ts" : "js"}`);
    // Dev runs under ts-node; a worker doesn't inherit its require hook.
    const worker = isTs
      ? new Worker(
          `process.env.TS_NODE_TRANSPILE_ONLY = "true";
           require("ts-node/register");
           require(${JSON.stringify(entry)});`,
          { eval: true }
        )
      : new Worker(entry);
    // Never keep the process alive just for an idle AI worker.
    worker.unref();
    worker.on("message", (msg: AIWorkerResponse) => {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error));
    });
    const fail = (err: Error) => {
      if (this.worker === worker) this.worker = null;
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(err);
      }
      this.pending.clear();
    };
    worker.on("error", (err) => {
      logger.error("AI worker crashed; respawning on next request", {}, err);
      fail(err);
    });
    worker.on("exit", (code) => fail(new Error(`AI worker exited (${code})`)));
    return worker;
  }

  request<T>(req: AIWorkerRequestBody): Promise<T> {
    const worker = (this.worker ??= this.spawn());
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`AI worker timed out after ${REQUEST_TIMEOUT_MS}ms`));
        // A wedged worker would time out every later request too.
        if (this.worker === worker) {
          this.worker = null;
          void worker.terminate();
        }
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      try {
        worker.postMessage({ ...req, id });
      } catch (err) {
        // e.g. DataCloneError for a state holding a function.
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err as Error);
      }
    });
  }
}

const slots = Array.from({ length: POOL_SIZE }, () => new AIWorkerSlot());
let inlineAI: AILogic | null = null;

function leastLoaded(): AIWorkerSlot {
  return slots.reduce((a, b) => (b.load < a.load ? b : a));
}

async function withFallback<T>(
  what: string,
  viaWorker: () => Promise<T>,
  inline: (ai: AILogic) => Promise<T>
): Promise<T> {
  try {
    return await viaWorker();
  } catch (error) {
    logger.error(
      `AI worker ${what} failed; running inline`,
      {},
      error instanceof Error ? error : new Error(String(error))
    );
    return inline((inlineAI ??= new AILogic()));
  }
}

export const aiWorkerPool = {
  makeAIMove(
    state: GameState,
    difficulty?: string,
    forPlayerId?: string
  ): Promise<AIMove> {
    return withFallback(
      "move",
      () =>
        leastLoaded().request<AIMove>({
          kind: "move",
          state,
          difficulty,
          forPlayerId,
        }),
      (ai) => ai.makeAIMove(state, difficulty, forPlayerId)
    );
  },

  chooseHandTargets(state: GameState): Promise<string[]> {
    return withFallback(
      "handTargets",
      () => leastLoaded().request<string[]>({ kind: "handTargets", state }),
      (ai) => ai.chooseHandTargets(state)
    );
  },
};
