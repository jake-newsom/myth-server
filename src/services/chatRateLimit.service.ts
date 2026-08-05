import { CHAT_CONFIG } from "../config/constants";

/**
 * In-memory token bucket rate limiter for chat, keyed by user id.
 *
 * In-memory is deliberate and degrades safely: a process restart grants
 * everyone a fresh bucket, which is harmless. If a second server process is
 * ever added these buckets become per-process (effectively N x the limit) and
 * should move to Redis INCR/EXPIRE -- see the scaling note in the plan.
 *
 * Card shares draw from the same bucket as text (a card-share spam wall is
 * the same problem as a text spam wall) and additionally have their own
 * longer minimum interval.
 */

const { BURST, REFILL_WINDOW_MS, MIN_INTERVAL_MS, SHARE_INTERVAL_MS } =
  CHAT_CONFIG.RATE_LIMIT;

/** Tokens regenerated per ms. */
const REFILL_RATE = BURST / REFILL_WINDOW_MS;

/** Buckets idle longer than this are dropped to bound memory. */
const IDLE_EVICTION_MS = 10 * 60 * 1000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

interface Bucket {
  tokens: number;
  lastRefillAt: number;
  lastMessageAt: number;
  lastShareAt: number;
}

const buckets = new Map<string, Bucket>();
let lastSweepAt = Date.now();

export interface RateLimitResult {
  allowed: boolean;
  /** Ms until the caller may retry. Only meaningful when `allowed` is false. */
  retryAfterMs: number;
}

const ALLOWED: RateLimitResult = { allowed: true, retryAfterMs: 0 };

function getBucket(userId: string, now: number): Bucket {
  let bucket = buckets.get(userId);
  if (!bucket) {
    bucket = {
      tokens: BURST,
      lastRefillAt: now,
      lastMessageAt: 0,
      lastShareAt: 0,
    };
    buckets.set(userId, bucket);
    return bucket;
  }

  // Lazy refill -- no timers, so an idle bucket costs nothing.
  const elapsed = now - bucket.lastRefillAt;
  if (elapsed > 0) {
    bucket.tokens = Math.min(BURST, bucket.tokens + elapsed * REFILL_RATE);
    bucket.lastRefillAt = now;
  }
  return bucket;
}

/**
 * Evict buckets that have been idle long enough that they'd be full anyway.
 * Piggybacks on calls rather than running a timer.
 */
function maybeSweep(now: number): void {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  for (const [userId, bucket] of buckets) {
    if (now - bucket.lastRefillAt > IDLE_EVICTION_MS) {
      buckets.delete(userId);
    }
  }
}

/**
 * Consume a token for a text message (or any user-authored post).
 * Enforces both the burst bucket and the 1/sec hard floor.
 */
export function consumeMessage(
  userId: string,
  now: number = Date.now()
): RateLimitResult {
  maybeSweep(now);
  const bucket = getBucket(userId, now);

  const sinceLast = now - bucket.lastMessageAt;
  if (sinceLast < MIN_INTERVAL_MS) {
    return { allowed: false, retryAfterMs: MIN_INTERVAL_MS - sinceLast };
  }

  if (bucket.tokens < 1) {
    return {
      allowed: false,
      retryAfterMs: Math.ceil((1 - bucket.tokens) / REFILL_RATE),
    };
  }

  bucket.tokens -= 1;
  bucket.lastMessageAt = now;
  return ALLOWED;
}

/**
 * Consume for a card share: the shared bucket plus a tighter dedicated
 * interval. Checked before the bucket so a share that's too soon doesn't
 * also burn a token.
 */
export function consumeShare(
  userId: string,
  now: number = Date.now()
): RateLimitResult {
  maybeSweep(now);
  const bucket = getBucket(userId, now);

  const sinceLastShare = now - bucket.lastShareAt;
  if (sinceLastShare < SHARE_INTERVAL_MS) {
    return { allowed: false, retryAfterMs: SHARE_INTERVAL_MS - sinceLastShare };
  }

  const result = consumeMessage(userId, now);
  if (!result.allowed) return result;

  bucket.lastShareAt = now;
  return ALLOWED;
}

/** Drop a user's bucket (e.g. on disconnect-driven cleanup or in tests). */
export function resetUser(userId: string): void {
  buckets.delete(userId);
}

/** Test seam. */
export function resetAll(): void {
  buckets.clear();
  lastSweepAt = Date.now();
}

export default { consumeMessage, consumeShare, resetUser, resetAll };
