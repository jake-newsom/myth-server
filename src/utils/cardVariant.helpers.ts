import db, { QueryExecutor } from "../config/db.config";

/**
 * Shared card-variant selection helpers.
 *
 * These PICK a variant but never grant it. Keeping selection separate from
 * granting lets two very different callers share the same pool logic:
 *
 *   - TowerService awards immediately (INSERT INTO user_owned_cards).
 *   - The onboarding track stores the picked card_variant_id on a mail row and
 *     lets the normal claim path grant it via RewardService.
 *
 * The pool definition (non-exclusive, released variant on a released
 * character) lives here so it can't drift between those callers.
 */

export interface PickedVariant {
  card_variant_id: string;
  name: string;
  rarity: string;
  image_url: string | null;
}

/** Weighted pick from a {key: weight} map. Returns a key, or null if empty. */
export function weightedPick<K extends string>(
  weights: Partial<Record<K, number>>
): K | null {
  const entries = (Object.entries(weights) as [K, number][]).filter(
    ([, w]) => w > 0
  );
  const total = entries.reduce((s, [, w]) => s + w, 0);
  if (total <= 0) return null;
  let roll = Math.random() * total;
  for (const [key, w] of entries) {
    roll -= w;
    if (roll < 0) return key;
  }
  return entries[entries.length - 1][0];
}

/**
 * Pick one random variant of an exact variant rarity (e.g. "legendary++"),
 * drawn uniformly from the released, non-exclusive pool. Returns null when no
 * such variant exists.
 */
export async function pickRandomVariantByRarity(
  variantRarity: string,
  exec: QueryExecutor = db
): Promise<PickedVariant | null> {
  const countQuery = `
    SELECT COUNT(*)::int as total
    FROM card_variants cv
    JOIN characters ch ON ch.character_id = cv.character_id
    WHERE cv.rarity::text = $1
      AND cv.is_exclusive = false
      AND cv.released_at <= NOW()
      AND ch.released_at <= NOW();
  `;
  const { rows: countRows } = await exec.query(countQuery, [variantRarity]);
  const total = Number(countRows[0]?.total || 0);
  if (total === 0) return null;

  const randomOffset = Math.floor(Math.random() * total);
  const query = `
    SELECT cv.card_variant_id, ch.name, cv.rarity, cv.image_url
    FROM card_variants cv
    JOIN characters ch ON cv.character_id = ch.character_id
    WHERE cv.rarity::text = $1
      AND cv.is_exclusive = false
      AND cv.released_at <= NOW()
      AND ch.released_at <= NOW()
    ORDER BY cv.card_variant_id
    LIMIT 1 OFFSET $2;
  `;
  const { rows } = await exec.query(query, [variantRarity, randomOffset]);
  if (rows.length === 0) return null;

  return {
    card_variant_id: rows[0].card_variant_id,
    name: rows[0].name,
    rarity: rows[0].rarity,
    image_url: rows[0].image_url ?? null,
  };
}

/**
 * Pick one random variant using a weighted roll over exact variant rarities,
 * falling back to the remaining rarities in the map if the rolled tier's pool
 * is empty. Guarantees a result whenever any listed tier has stock.
 */
export async function pickWeightedVariantByRarity(
  rarityWeights: Record<string, number>,
  exec: QueryExecutor = db
): Promise<PickedVariant | null> {
  const primary = weightedPick(rarityWeights);
  if (!primary) return null;

  const order = [
    primary,
    ...Object.keys(rarityWeights).filter((r) => r !== primary),
  ];

  for (const rarity of order) {
    const picked = await pickRandomVariantByRarity(rarity, exec);
    if (picked) return picked;
  }

  return null;
}
