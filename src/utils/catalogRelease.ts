/**
 * Catalog visibility for characters and card_variants.
 * A row is public when released_at <= NOW(). Admins may request unreleased rows.
 */

export type CatalogQueryOptions = {
  /** When true, skip released_at filtering (admin catalog). */
  includeUnreleased?: boolean;
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
