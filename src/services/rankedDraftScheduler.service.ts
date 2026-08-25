import RankedMatchmakingService from "./rankedMatchmaking.service";
import RankedDraftOrchestrator from "./rankedDraftOrchestrator.service";
import logger from "../utils/logger";

/**
 * The Ranked Draft background tick, owned by ONE module so every entrypoint
 * starts the same thing.
 *
 * It previously lived inside app.ts's `require.main === module` block, which
 * meant it ran under `ts-node src/app.ts` (dev) and never under
 * `node server.js` (prod) — prod only *imports* dist/app, so that block is
 * dead there. The visible damage in production was:
 *   - the widening rating window never re-evaluated, so two queued players
 *     outside the opening +/-100 band were never paired (the only prod call to
 *     runMatchPass is the one on queue join);
 *   - draft timers are in-process, so every redeploy stranded live drafts with
 *     nothing to re-arm them;
 *   - a stalled ranked game was never reaped, permanently locking its player
 *     out of the mode behind the ACTIVE_GAME_EXISTS guard.
 *
 * Same class of bug as the `app.set("io")` split, and fixed the same way:
 * export it, call it from both entrypoints.
 */

export const RANKED_DRAFT_TICK_MS = 5000;

let tickInterval: NodeJS.Timeout | null = null;

/**
 * Guards against overlapping ticks.
 *
 * The tick is async and sweeps sessions serially, so a sweep that outruns the
 * interval would otherwise re-enter and run onDeadlineExpired on the same
 * session concurrently — two auto-picks racing for one slot, and two racers
 * inside completeDraft.
 */
let ticking = false;

async function runTick(): Promise<void> {
  if (ticking) {
    logger.warn("[rankedDraft] previous tick still running, skipping this one");
    return;
  }
  ticking = true;
  try {
    await RankedMatchmakingService.runMatchPass();
    await RankedDraftOrchestrator.sweepExpiredSessions();
    await RankedDraftOrchestrator.reapStaleRankedGames();
  } catch (error) {
    logger.error("[rankedDraft] tick failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    ticking = false;
  }
}

/**
 * Starts the tick. Idempotent: a second call is a no-op, so an entrypoint that
 * both imports app.ts and starts the scheduler itself cannot double-schedule.
 */
export function startRankedDraftScheduler(): void {
  if (tickInterval) return;

  tickInterval = setInterval(() => {
    void runTick();
  }, RANKED_DRAFT_TICK_MS);
  // Never hold the process open for a draft clock.
  if (typeof tickInterval.unref === "function") tickInterval.unref();

  // Resolve anything stranded by the previous process before the first tick.
  void runTick();

  logger.info("[rankedDraft] scheduler started", {
    tickMs: RANKED_DRAFT_TICK_MS,
  });
}

export function stopRankedDraftScheduler(): void {
  if (!tickInterval) return;
  clearInterval(tickInterval);
  tickInterval = null;
}

/** Test seam. */
export function isRankedDraftSchedulerRunning(): boolean {
  return tickInterval !== null;
}

export default {
  startRankedDraftScheduler,
  stopRankedDraftScheduler,
  isRankedDraftSchedulerRunning,
  RANKED_DRAFT_TICK_MS,
};
