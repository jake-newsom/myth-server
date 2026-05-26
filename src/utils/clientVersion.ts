/**
 * Client version helpers for feature gating during phased rollouts.
 */

const DEFAULT_MULLIGAN_MIN_CLIENT_VERSION = "1.0.10";

export const CLIENT_VERSION_HEADER = "X-Client-Version";

export function getMulliganMinClientVersion(): string {
  return (
    process.env.MULLIGAN_MIN_CLIENT_VERSION?.trim() ||
    DEFAULT_MULLIGAN_MIN_CLIENT_VERSION
  );
}

function parseVersionParts(version: string): number[] {
  const clean = version.replace(/^v/i, "").trim();
  const parts = clean.split(".").map((p) => parseInt(p, 10) || 0);
  while (parts.length < 3) parts.push(0);
  return parts;
}

/** Returns -1 if a < b, 0 if equal, 1 if a > b */
export function compareSemver(a: string, b: string): number {
  const pa = parseVersionParts(a);
  const pb = parseVersionParts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}

/**
 * True when the client advertises a version that includes the mulligan UI/protocol.
 * Missing or unparsable versions are treated as legacy (no mulligan phase).
 */
export function clientSupportsMulligan(clientVersion: string | undefined | null): boolean {
  if (!clientVersion?.trim()) return false;
  const min = getMulliganMinClientVersion();
  return compareSemver(clientVersion.trim(), min) >= 0;
}

export function getClientVersionFromHeader(
  headers: Record<string, string | string[] | undefined> | undefined
): string | undefined {
  if (!headers) return undefined;
  const raw = headers[CLIENT_VERSION_HEADER] ?? headers[CLIENT_VERSION_HEADER.toLowerCase()];
  if (Array.isArray(raw)) return raw[0];
  return typeof raw === "string" ? raw : undefined;
}
