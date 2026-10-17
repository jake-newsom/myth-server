import { parentPort } from "worker_threads";
import { AILogic } from "./ai.logic";

/*
 * Worker-thread entry for AI move selection (see ai.worker-pool.ts). Runs
 * the same AILogic the server used inline, so search CPU no longer competes
 * with socket/HTTP handling on the main event loop.
 */

export type AIWorkerRequest =
  | {
      id: number;
      kind: "move";
      state: any;
      difficulty?: string;
      forPlayerId?: string;
    }
  | { id: number; kind: "handTargets"; state: any };

export type AIWorkerResponse =
  | { id: number; ok: true; result: any }
  | { id: number; ok: false; error: string };

const ai = new AILogic();

parentPort?.on("message", async (req: AIWorkerRequest) => {
  try {
    const result =
      req.kind === "move"
        ? await ai.makeAIMove(req.state, req.difficulty, req.forPlayerId)
        : await ai.chooseHandTargets(req.state);
    parentPort!.postMessage({ id: req.id, ok: true, result } as AIWorkerResponse);
  } catch (error) {
    parentPort!.postMessage({
      id: req.id,
      ok: false,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    } as AIWorkerResponse);
  }
});
