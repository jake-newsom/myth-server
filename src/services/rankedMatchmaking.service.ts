import db from "../config/db.config";
import LeaderboardModel from "../models/leaderboard.model";
import Orchestrator from "./rankedDraftOrchestrator.service";
import logger from "../utils/logger";

/**
 * Skill-based queue for Ranked Draft.
 *
 * Reconciles with docs/pvp-matchmaking-plan.md: same Elo, same widening-window
 * matcher, same anti-stall behaviour. The one term that plan carries which is
 * dropped here is Deck Power — ranked draft has no deck at queue time, and it
 * does not need a substitute: a shared catalog plus a fixed power cap makes
 * both sides structurally symmetric, which is the problem DP existed to solve.
 *
 * Kept in memory deliberately for now, matching the existing unranked queue.
 * The `matchmaking_queue` table both plans call for is the shared migration
 * path for BOTH queues, and moving them together is cheaper than moving one.
 */

interface RankedQueueEntry {
  userId: string;
  rating: number;
  queuedAt: number;
}

const queue: RankedQueueEntry[] = [];

/** ±window, widening with wait, capped. Straight from the matchmaking plan. */
const BASE_WINDOW = 100;
const WIDEN_PER_10S = 50;
const MAX_WINDOW = 600;

export function ratingWindowFor(waitMs: number): number {
  const steps = Math.floor(waitMs / 10_000);
  return Math.min(MAX_WINDOW, BASE_WINDOW + steps * WIDEN_PER_10S);
}

export function isUserInRankedQueue(userId: string): boolean {
  return queue.some((e) => e.userId === userId);
}

export function rankedQueueLength(): number {
  return queue.length;
}

/** Current ranked-draft rating, defaulting to the ladder's starting value. */
export async function getRankedRating(userId: string): Promise<number> {
  const season = LeaderboardModel.getRankedDraftSeason();
  const { rows } = await db.query(
    `SELECT rating FROM user_rankings WHERE user_id = $1 AND season = $2`,
    [userId, season]
  );
  return rows[0]?.rating ?? 1000;
}

export async function joinQueue(userId: string): Promise<void> {
  if (isUserInRankedQueue(userId)) return;
  queue.push({
    userId,
    rating: await getRankedRating(userId),
    queuedAt: Date.now(),
  });
}

export function leaveQueue(userId: string): boolean {
  const i = queue.findIndex((e) => e.userId === userId);
  if (i === -1) return false;
  queue.splice(i, 1);
  return true;
}

export function queueStatus(
  userId: string
): { waitSeconds: number; queueLength: number } | null {
  const entry = queue.find((e) => e.userId === userId);
  if (!entry) return null;
  return {
    waitSeconds: Math.floor((Date.now() - entry.queuedAt) / 1000),
    queueLength: queue.length,
  };
}

/**
 * One matcher pass: greedily pair the closest-rated mutually-eligible players.
 *
 * "Mutually eligible" matters — the pair is only made if the gap fits inside
 * BOTH players' windows, so a long-waiting player cannot drag someone who just
 * queued into a lopsided match.
 */
export async function runMatchPass(now: number = Date.now()): Promise<number> {
  if (queue.length < 2) return 0;

  const byRating = [...queue].sort((a, b) => a.rating - b.rating);
  const paired = new Set<string>();
  const pairs: [RankedQueueEntry, RankedQueueEntry][] = [];

  for (let i = 0; i < byRating.length; i++) {
    const a = byRating[i];
    if (paired.has(a.userId)) continue;
    for (let j = i + 1; j < byRating.length; j++) {
      const b = byRating[j];
      if (paired.has(b.userId)) continue;
      const gap = Math.abs(a.rating - b.rating);
      if (
        gap <= ratingWindowFor(now - a.queuedAt) &&
        gap <= ratingWindowFor(now - b.queuedAt)
      ) {
        paired.add(a.userId);
        paired.add(b.userId);
        pairs.push([a, b]);
        break;
      }
    }
  }

  for (const [a, b] of pairs) {
    leaveQueue(a.userId);
    leaveQueue(b.userId);
    try {
      await Orchestrator.startSession(a.userId, b.userId);
      logger.info("[rankedMatchmaking] paired", {
        p1: a.userId,
        p2: b.userId,
        ratingGap: Math.abs(a.rating - b.rating),
      });
    } catch (error) {
      logger.error("[rankedMatchmaking] failed to start session", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return pairs.length;
}

/** Test seam. */
export function _resetQueue(): void {
  queue.length = 0;
}

export default {
  joinQueue,
  leaveQueue,
  queueStatus,
  runMatchPass,
  isUserInRankedQueue,
  rankedQueueLength,
  ratingWindowFor,
  getRankedRating,
  _resetQueue,
};
