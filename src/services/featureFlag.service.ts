// myth-server/src/services/featureFlag.service.ts

import db, { QueryExecutor } from "../config/db.config";
import FeatureFlagModel, { normalizeKey } from "../models/featureFlag.model";
import logger from "../utils/logger";
import {
  CreateFeatureFlagInput,
  FeatureFlag,
  FeatureFlagEvaluation,
  FeatureFlagWithOverrideCount,
  UpdateFeatureFlagInput,
  UserFeatureFlagOverride,
} from "../types/featureFlag.types";

/**
 * How long a user's resolved flag set is trusted before we re-read it.
 *
 * This is deliberately short. Flags are read on hot paths (per request, and
 * potentially inside the game engine), so a per-check query is not affordable;
 * but a stale window longer than a few seconds makes "flip the flag and retry"
 * confusing to test against. Writes through this service invalidate eagerly,
 * so the TTL only matters for writes made out-of-band (psql, another process).
 */
const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  enabledKeys: Set<string>;
  expiresAt: number;
}

/**
 * In-process cache, keyed by user. Intentionally NOT Redis: the value is tiny,
 * cheap to rebuild, and per-process staleness bounded by CACHE_TTL_MS is
 * acceptable — whereas a shared cache would need distributed invalidation for
 * no real gain. Consequence to know about: on a multi-instance deploy, a flag
 * flip can take up to CACHE_TTL_MS to be visible on every instance.
 */
const userCache = new Map<string, CacheEntry>();

function readCache(userId: string): Set<string> | null {
  const entry = userCache.get(userId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    userCache.delete(userId);
    return null;
  }
  return entry.enabledKeys;
}

function writeCache(userId: string, enabledKeys: Set<string>): void {
  userCache.set(userId, {
    enabledKeys,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

/**
 * How often expired entries are swept out of `userCache`.
 *
 * Eviction is otherwise lazy: `readCache` only drops an entry when that same
 * user is read again after their TTL lapsed. A user who plays once and never
 * returns is never read again, so their entry would sit in the map for the
 * process lifetime. The entries are tiny (a Set of short strings), so this is
 * slow growth rather than an urgent leak — a sweep well above the 30s TTL is
 * plenty, and keeps the map proportional to *recently active* users instead of
 * to every user the process has ever seen.
 */
const CACHE_SWEEP_INTERVAL_MS = 5 * 60_000;

let sweepTimer: NodeJS.Timeout | null = null;

/**
 * Drop every entry whose TTL has lapsed.
 *
 * Bounded by the map size and does no I/O, so it is safe to run inline on a
 * timer. Returns the number of entries removed for logging/tests.
 */
function sweepExpired(): number {
  const now = Date.now();
  let removed = 0;
  for (const [userId, entry] of userCache) {
    if (entry.expiresAt <= now) {
      userCache.delete(userId);
      removed++;
    }
  }
  return removed;
}

const FeatureFlagService = {
  // ---- Read path (the one used by feature code) -----------------------------

  /**
   * The primary consumer API:
   *
   *   if (await FeatureFlagService.isEnabled(userId, "new-tower-scoring")) { ... }
   *
   * Never throws and never rejects. An unknown key, a null userId, or a database
   * failure all resolve to `false`, i.e. "run the old, live code path". That is
   * the only safe default now that we're in production: a flag lookup must not
   * be able to take down a request.
   */
  async isEnabled(userId: string | null | undefined, key: string): Promise<boolean> {
    if (!userId) return false;
    const normalized = normalizeKey(key);
    if (!normalized) return false;

    try {
      const enabledKeys = await this.getEnabledKeys(userId);
      return enabledKeys.has(normalized);
    } catch (error) {
      logger.error(
        "Feature flag lookup failed; defaulting to disabled",
        { userId, key: normalized },
        error instanceof Error ? error : new Error(String(error))
      );
      return false;
    }
  },

  /**
   * The full set of ON flag keys for a user, cached. Prefer `isEnabled` in
   * feature code; use this when checking several flags at once or building a
   * client payload.
   */
  async getEnabledKeys(userId: string): Promise<Set<string>> {
    const cached = readCache(userId);
    if (cached) return cached;

    const keys = await FeatureFlagModel.findEnabledKeysForUser(userId);
    const set = new Set(keys);
    writeCache(userId, set);
    return set;
  },

  /** Array form for JSON responses. */
  async getEnabledKeysList(userId: string): Promise<string[]> {
    const set = await this.getEnabledKeys(userId);
    return Array.from(set).sort();
  },

  /**
   * Resolve a flag for a user AND report why. Powers the admin evaluate
   * endpoint — "is it on for jake, and is that because of the global switch or
   * his override?" — so it deliberately bypasses the cache and re-reads.
   */
  async evaluate(userId: string, key: string): Promise<FeatureFlagEvaluation> {
    const normalized = normalizeKey(key);
    const flag = await FeatureFlagModel.findByKey(normalized);
    if (!flag) {
      return { key: normalized, enabled: false, source: "unknown_flag" };
    }

    const overrides = await FeatureFlagModel.findOverridesForUser(userId);
    const override = overrides.find((o) => o.key === normalized);
    if (override) {
      return {
        key: normalized,
        enabled: override.enabled,
        source: "user_override",
      };
    }

    return {
      key: normalized,
      enabled: flag.enabled_globally,
      source: "global",
    };
  },

  // ---- Cache control --------------------------------------------------------

  invalidateUser(userId: string): void {
    userCache.delete(userId);
  },

  /**
   * Called after any change to a flag's global state, which can affect every
   * user at once. Clearing the whole map is fine — it's small and refills
   * lazily on the next read per user.
   */
  invalidateAll(): void {
    userCache.clear();
  },

  /**
   * Begin periodically sweeping expired cache entries. Idempotent — calling it
   * twice does not stack timers.
   *
   * `unref()` so a pending sweep never holds the process open on shutdown; this
   * is a memory hygiene task, not work that must finish.
   */
  startCacheSweeper(): void {
    if (sweepTimer) return;
    sweepTimer = setInterval(() => {
      const removed = sweepExpired();
      if (removed > 0) {
        logger.debug("Feature flag cache swept", {
          removed,
          remaining: userCache.size,
        });
      }
    }, CACHE_SWEEP_INTERVAL_MS);
    sweepTimer.unref?.();
  },

  stopCacheSweeper(): void {
    if (!sweepTimer) return;
    clearInterval(sweepTimer);
    sweepTimer = null;
  },

  /** Run one sweep immediately. Exposed for tests and manual use. */
  sweepCacheNow(): number {
    return sweepExpired();
  },

  /** Current number of cached users. Exposed for tests and diagnostics. */
  cacheSize(): number {
    return userCache.size;
  },

  // ---- Admin / management ---------------------------------------------------

  async listFlags(): Promise<FeatureFlagWithOverrideCount[]> {
    return FeatureFlagModel.findAll();
  },

  async getFlagByKey(key: string): Promise<FeatureFlag | null> {
    return FeatureFlagModel.findByKey(key);
  },

  async getFlagById(featureFlagId: string): Promise<FeatureFlag | null> {
    return FeatureFlagModel.findById(featureFlagId);
  },

  /**
   * Validate an authored flag key. Returns human-readable problems; empty means
   * OK. Keys are constrained to a slug shape so they stay usable as literals in
   * client and server code.
   */
  validateKey(key: unknown): string[] {
    if (typeof key !== "string" || !key.trim()) {
      return ["`key` is required."];
    }
    const normalized = normalizeKey(key);
    if (normalized.length > 128) {
      return ["`key` must be 128 characters or fewer."];
    }
    if (!/^[a-z0-9][a-z0-9-_.]*$/.test(normalized)) {
      return [
        "`key` must start with a letter or digit and contain only lowercase letters, digits, hyphens, underscores, and dots.",
      ];
    }
    return [];
  },

  async createFlag(input: CreateFeatureFlagInput): Promise<FeatureFlag> {
    const flag = await FeatureFlagModel.create(input);
    // A brand-new flag can only be ON for everyone if it was created that way.
    if (flag.enabled_globally) this.invalidateAll();
    logger.info("Feature flag created", {
      key: flag.key,
      enabled_globally: flag.enabled_globally,
    });
    return flag;
  },

  async updateFlag(
    featureFlagId: string,
    input: UpdateFeatureFlagInput
  ): Promise<FeatureFlag | null> {
    const flag = await FeatureFlagModel.update(featureFlagId, input);
    if (flag && input.enabled_globally !== undefined) {
      this.invalidateAll();
      logger.info("Feature flag global state changed", {
        key: flag.key,
        enabled_globally: flag.enabled_globally,
      });
    }
    return flag;
  },

  async deleteFlag(featureFlagId: string): Promise<boolean> {
    const flag = await FeatureFlagModel.findById(featureFlagId);
    const removed = await FeatureFlagModel.remove(featureFlagId);
    if (removed) {
      this.invalidateAll();
      logger.info("Feature flag deleted", { key: flag?.key });
    }
    return removed;
  },

  async listUsersForFlag(
    featureFlagId: string
  ): Promise<UserFeatureFlagOverride[]> {
    return FeatureFlagModel.findUsersForFlag(featureFlagId);
  },

  async listOverridesForUser(
    userId: string
  ): Promise<UserFeatureFlagOverride[]> {
    return FeatureFlagModel.findOverridesForUser(userId);
  },

  async setUserOverride(
    featureFlagId: string,
    userId: string,
    enabled: boolean,
    note: string | null = null
  ): Promise<UserFeatureFlagOverride> {
    const override = await FeatureFlagModel.setUserOverride(
      featureFlagId,
      userId,
      enabled,
      note
    );
    this.invalidateUser(userId);
    logger.info("Feature flag user override set", {
      key: override.key,
      userId,
      enabled,
    });
    return override;
  },

  async removeUserOverride(
    featureFlagId: string,
    userId: string
  ): Promise<boolean> {
    const removed = await FeatureFlagModel.removeUserOverride(
      featureFlagId,
      userId
    );
    if (removed) this.invalidateUser(userId);
    return removed;
  },
};

export default FeatureFlagService;
