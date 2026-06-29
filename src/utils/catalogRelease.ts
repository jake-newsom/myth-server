/**
 * Catalog visibility for characters and card_variants.
 * A row is public when released_at <= NOW(). Admins may request unreleased rows.
 */

import { getClientVersionFromHeader } from "./clientVersion";

export type CatalogQueryOptions = {
  /** When true, skip released_at filtering (admin catalog). */
  includeUnreleased?: boolean;
  /**
   * The requesting client's advertised version (X-Client-Version), used to gate
   * rows by min_app_version. Undefined = unknown client. See catalogVersion.ts.
   */
  clientVersion?: string;
};

export function isAdminUser(
  user: { role?: string } | null | undefined
): boolean {
  return user?.role === "admin";
}

export function catalogOptionsFromUser(
  user: { role?: string } | null | undefined
): CatalogQueryOptions {
  return { includeUnreleased: isAdminUser(user) };
}

/**
 * Builds catalog options from an Express request: admin bypass from req.user and
 * the client version from the X-Client-Version header. Prefer this over
 * catalogOptionsFromUser at request handlers so min_app_version gating applies.
 */
export function catalogOptionsFromRequest(req: {
  user?: { role?: string } | null;
  headers?: Record<string, string | string[] | undefined>;
}): CatalogQueryOptions {
  return {
    includeUnreleased: isAdminUser(req.user),
    clientVersion: getClientVersionFromHeader(req.headers),
  };
}

/** SQL expression: character row is visible in the public catalog. */
export function sqlCharacterReleased(
  tableAlias = "ch",
  includeUnreleased = false
): string {
  if (includeUnreleased) return "TRUE";
  return `${tableAlias}.released_at <= NOW()`;
}

/** SQL expression: variant row is visible in the public catalog. */
export function sqlVariantReleased(
  tableAlias = "cv",
  includeUnreleased = false
): string {
  if (includeUnreleased) return "TRUE";
  return `${tableAlias}.released_at <= NOW()`;
}

/** Both character and variant must be released (when filtering). */
export function sqlCatalogReleased(
  chAlias = "ch",
  cvAlias = "cv",
  includeUnreleased = false
): string {
  if (includeUnreleased) return "TRUE";
  return `(${sqlCharacterReleased(chAlias, false)} AND ${sqlVariantReleased(cvAlias, false)})`;
}

/**
 * Append to an existing WHERE clause: " AND ch... AND cv..."
 * Returns empty string when includeUnreleased is true.
 */
export function andCatalogReleased(
  chAlias = "ch",
  cvAlias = "cv",
  includeUnreleased = false
): string {
  if (includeUnreleased) return "";
  return ` AND ${sqlCharacterReleased(chAlias, false)} AND ${sqlVariantReleased(cvAlias, false)}`;
}

/** When only the characters table is queried (no variant join). */
export function andCharacterReleased(
  chAlias = "ch",
  includeUnreleased = false
): string {
  if (includeUnreleased) return "";
  return ` AND ${sqlCharacterReleased(chAlias, false)}`;
}
