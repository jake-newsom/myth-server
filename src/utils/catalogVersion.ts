/**
 * Minimum-app-version gating for catalog resources (characters, card_variants,
 * card_borders, card_backs).
 *
 * A row carries an optional `min_app_version`. When set, the row is only served
 * to clients whose advertised X-Client-Version is >= that value. Comparison uses
 * the same semver comparator as the rest of the client feature-gating code so we
 * have a single source of truth for version ordering.
 *
 * This is intentionally applied in-application (not in SQL): the catalog tables
 * are tiny and fully cached, and reusing compareSemver avoids a second,
 * subtly-different semver mechanism living in raw SQL.
 *
 * Gating applies to discovery/catalog reads only. Ownership / equip-resolution
 * paths are deliberately left ungated so a player never loses access to a
 * cosmetic they already own just because their client is behind.
 */

import { compareSemver } from "./clientVersion";

export type VersionGateOptions = {
  /** The client's advertised version (X-Client-Version). Undefined = unknown. */
  clientVersion?: string;
  /** When true, skip version gating entirely (admin catalog), mirroring released_at. */
  includeUnreleased?: boolean;
};

/**
 * True when a row with the given min_app_version should be visible to the
 * requesting client.
 *
 * - includeUnreleased (admin): always visible.
 * - null/empty min_app_version: unrestricted, always visible.
 * - missing/unparseable client version: withhold gated rows (treat as legacy),
 *   matching how clientSupportsMulligan treats unknown versions.
 */
export function meetsMinAppVersion(
  minAppVersion: string | null | undefined,
  opts: VersionGateOptions = {}
): boolean {
  if (opts.includeUnreleased) return true;
  const min = minAppVersion?.trim();
  if (!min) return true;
  const client = opts.clientVersion?.trim();
  if (!client) return false;
  return compareSemver(client, min) >= 0;
}

/** Clean numeric MAJOR.MINOR.PATCH, no pre-release/build metadata. */
const MIN_APP_VERSION_RE = /^\d+\.\d+\.\d+$/;

export type NormalizedMinAppVersion =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

/**
 * Validates and normalizes an admin-supplied min_app_version. Empty/blank/null
 * becomes null (unrestricted). Anything non-blank must be clean X.Y.Z so it
 * stays comparable by compareSemver. Returns a discriminated result so callers
 * can surface a 400 instead of persisting an unparseable value.
 *
 * Pass `undefined` to mean "field not present" — returns { ok: true, value: null }
 * for create paths; PATCH callers should only invoke this when the key exists.
 */
export function normalizeMinAppVersion(
  raw: unknown
): NormalizedMinAppVersion {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") {
    return { ok: false, error: "min_app_version must be a string" };
  }
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (!MIN_APP_VERSION_RE.test(trimmed)) {
    return {
      ok: false,
      error: "min_app_version must be in MAJOR.MINOR.PATCH form (e.g. 1.2.0)",
    };
  }
  return { ok: true, value: trimmed };
}
