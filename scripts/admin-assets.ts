/**
 * Resolve on-disk paths for raw (pre-zip) game assets served only by the npm admin server.
 * Configure ADMIN_ASSET_ROOT or use default content/assets/raw under the repo.
 *
 * DB image_url convention:  "japanese/rare/amaterasu-1.webp"
 * Both the client and admin UI hardcode a "cards/" prefix, so:
 *   on disk  → content/assets/raw/cards/japanese/rare/amaterasu-1.webp
 *   in ZIP   → cards/japanese/rare/amaterasu-1.webp
 */
import fs from "fs";
import path from "path";

const PROJECT_ROOT = path.join(__dirname, "..");
const CARDS_PREFIX = "cards/";

export function getAdminAssetRootAbs(): string {
  const env = process.env.ADMIN_ASSET_ROOT?.trim();
  if (env) return path.resolve(env);
  return path.join(PROJECT_ROOT, "content", "assets", "raw");
}

function isPathInsideRoot(rootAbs: string, candidateAbs: string): boolean {
  const root = path.resolve(rootAbs);
  const file = path.resolve(candidateAbs);
  if (root === file) return true;
  const rel = path.relative(root, file);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Normalize a DB image_url into the canonical relative path used on disk and in ZIPs.
 * Strips leading slashes, "assets/" prefixes, and prepends "cards/" when absent.
 * Returns null for http(s) URLs or empty/invalid paths.
 */
export function normalizeImageRef(ref: string): string | null {
  if (!ref || typeof ref !== "string") return null;
  let s = ref.trim();
  if (/^https?:\/\//i.test(s)) return null;

  s = s.split("?")[0].split("#")[0];
  s = s.replace(/^\/+/, "");
  s = s.replace(/\\/g, "/");
  while (s.toLowerCase().startsWith("assets/")) {
    s = s.slice("assets/".length);
  }
  if (!s || s.includes("..") || s.startsWith("/")) return null;

  if (!s.toLowerCase().startsWith(CARDS_PREFIX)) {
    s = CARDS_PREFIX + s;
  }
  return s;
}

/**
 * Map a DB image_url (e.g. "japanese/rare/amaterasu-1.webp") to an absolute file path
 * under the admin asset root (prepends cards/ automatically).
 * Returns null if the reference is an http(s) URL (client should load directly).
 */
export function resolveRawAssetPath(ref: string): { abs: string } | { error: string } | null {
  const normalized = normalizeImageRef(ref);
  if (normalized === null) {
    if (ref && /^https?:\/\//i.test(ref.trim())) return null;
    return { error: "Missing or invalid ref" };
  }

  const root = getAdminAssetRootAbs();
  const abs = path.normalize(path.join(root, normalized));

  if (!isPathInsideRoot(root, abs)) {
    return { error: "Invalid path" };
  }

  return { abs };
}

export function adminAssetRootExists(): boolean {
  try {
    return fs.existsSync(getAdminAssetRootAbs());
  } catch {
    return false;
  }
}

/**
 * Path inside a client patch ZIP: relative to game /assets (no "assets/" prefix).
 * Always includes the "cards/" prefix (e.g. "cards/japanese/rare/amaterasu-1.webp").
 * Returns null for http(s) URLs or invalid paths.
 */
export function toPatchZipEntry(ref: string): string | null {
  return normalizeImageRef(ref);
}
