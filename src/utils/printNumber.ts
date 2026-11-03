/**
 * First-edition print numbering.
 *
 * Every card variant (each art) counts its player-minted copies. The first
 * FIRST_EDITION_LIMIT of each carry the "1st Edition" badge. Numbers are handed
 * out once and never reused, so sacrificing a first edition retires it.
 *
 * Numbering is opt-in per grant path, never a column default or trigger: only
 * paths that give a real player a collection card call this. AI deck copies,
 * tower AI decks and starter decks don't, so they can never use up slots.
 * Any new grant path stays un-numbered until it opts in.
 */
import type { QueryExecutor } from "../config/db.config";

export const FIRST_EDITION_LIMIT = 50;

/** The shared AI account. Its cards are never numbered. */
const AI_PLAYER_ID = "00000000-0000-0000-0000-000000000000";

export function isFirstEdition(printNumber: number | null | undefined): boolean {
  return printNumber != null && printNumber <= FIRST_EDITION_LIMIT;
}

/**
 * Claim the next print number for each entry of `variantIds` (duplicates get
 * consecutive numbers). Returns numbers aligned to the input order.
 *
 * Run it on the same transaction client as the card insert so a rolled-back
 * grant gives its numbers back. Variants are locked in sorted order so
 * concurrent multi-variant pack opens can't deadlock each other.
 */
export async function claimPrintNumbers(
  exec: QueryExecutor,
  userId: string,
  variantIds: string[]
): Promise<Array<number | null>> {
  if (variantIds.length === 0) return [];
  if (userId === AI_PLAYER_ID) return variantIds.map(() => null);

  const counts = new Map<string, number>();
  for (const id of variantIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  const ids = [...counts.keys()].sort();

  const { rows } = await exec.query(
    `INSERT INTO variant_print_counters (card_variant_id, minted)
     SELECT v, c FROM UNNEST($1::uuid[], $2::int[]) AS t(v, c)
     ORDER BY v
     ON CONFLICT (card_variant_id)
       DO UPDATE SET minted = variant_print_counters.minted + EXCLUDED.minted
     RETURNING card_variant_id, minted`,
    [ids, ids.map((id) => counts.get(id)!)]
  );

  // Next number to hand out per variant = new total - claimed + 1.
  const next = new Map<string, number>();
  for (const r of rows) {
    next.set(r.card_variant_id, r.minted - counts.get(r.card_variant_id)! + 1);
  }
  return variantIds.map((id) => {
    const n = next.get(id)!;
    next.set(id, n + 1);
    return n;
  });
}
