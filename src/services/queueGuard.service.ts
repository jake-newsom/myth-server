import { isUserInMatchmakingQueue } from "../api/controllers/matchmaking.controller";
import { isUserInRankedQueue } from "./rankedMatchmaking.service";

/**
 * Blocks starting a non-PvP game (solo, tower, saga) while the player is
 * sitting in the unranked or ranked matchmaking queue.
 *
 * Both queues are in-memory (see rankedMatchmaking.service for why), so this
 * is a synchronous check with no DB cost. The reverse direction is already
 * guarded: matchmaking.controller.joinQueue rejects a queue join when a pvp /
 * ranked_draft game is active.
 *
 * Kill switch: set ALLOW_GAME_START_WHILE_QUEUED=true to restore the previous
 * behaviour without a redeploy of new code.
 */

export const QUEUE_CONFLICT_MESSAGE =
  "You cannot start another game while in the online queue";

export const QUEUE_CONFLICT_CODE = "IN_MATCHMAKING_QUEUE";

function guardDisabled(): boolean {
  return process.env.ALLOW_GAME_START_WHILE_QUEUED === "true";
}

/** True when the user is queued for unranked or ranked PvP. */
export function isUserInAnyMatchmakingQueue(userId: string): boolean {
  if (guardDisabled()) return false;
  return isUserInMatchmakingQueue(userId) || isUserInRankedQueue(userId);
}

export default {
  isUserInAnyMatchmakingQueue,
  QUEUE_CONFLICT_MESSAGE,
  QUEUE_CONFLICT_CODE,
};
