import db, { QueryExecutor } from "../config/db.config";

/**
 * Reward bundle stored on a tier row. Asset arrays may be empty when a
 * season's exclusive art has not been assigned yet — currency/packs still pay
 * out. Display metadata drives the in-app rewards modal.
 */
export interface SeasonRewardBundle {
  gems: number;
  packs: number;
  card_variant_ids: string[];
  border_ids: string[];
  card_back_ids: string[];
  display: {
    card_count: number;
    card_label: string | null;
    cosmetic_labels: string[];
  };
}

export type SeasonRewardAxis = "overall" | "pantheon";

/** Resolved display data for the asset IDs referenced by a tier bundle. */
export interface ResolvedRewardCard {
  card_variant_id: string;
  base_card_id: string;
  name: string;
  rarity: string;
  image_url: string;
}
export interface ResolvedRewardBorder {
  border_id: string;
  name: string;
  image_url: string;
  animation_key: string | null;
}
export interface ResolvedRewardCardBack {
  back_id: string;
  name: string;
  image_url: string;
}
export interface ResolvedRewardAssets {
  cards: ResolvedRewardCard[];
  borders: ResolvedRewardBorder[];
  card_backs: ResolvedRewardCardBack[];
}

export interface SeasonRewardTierRow {
  id: string;
  season_id: string | null;
  axis: SeasonRewardAxis;
  tier_key: string;
  sort_order: number;
  label: string;
  threshold_kind: "exact_rank" | "percentile";
  threshold_value: number;
  bundle_json: SeasonRewardBundle;
  created_at: Date;
  updated_at: Date;
}

const SeasonRewardTierModel = {
  /**
   * Resolve the tier list for a season and axis: season-specific override rows
   * if any exist for that axis, otherwise the template rows (season_id IS NULL)
   * for that axis. Returned in prestige order (sort_order ASC, highest first).
   */
  async getTiersForSeason(
    seasonId: string,
    axis: SeasonRewardAxis,
    executor: QueryExecutor = db
  ): Promise<SeasonRewardTierRow[]> {
    const { rows } = await executor.query(
      `
      SELECT id, season_id, axis, tier_key, sort_order, label,
             threshold_kind, threshold_value::float8 AS threshold_value,
             bundle_json, created_at, updated_at
      FROM season_reward_tiers
      WHERE season_id = $1 AND axis = $2
      ORDER BY sort_order ASC;
      `,
      [seasonId, axis]
    );

    if (rows.length > 0) {
      return rows.map(mapRow);
    }

    return this.getTemplateTiers(axis, executor);
  },

  /** Default tier rows for an axis, used when a season has no overrides. */
  async getTemplateTiers(
    axis: SeasonRewardAxis,
    executor: QueryExecutor = db
  ): Promise<SeasonRewardTierRow[]> {
    const { rows } = await executor.query(
      `
      SELECT id, season_id, axis, tier_key, sort_order, label,
             threshold_kind, threshold_value::float8 AS threshold_value,
             bundle_json, created_at, updated_at
      FROM season_reward_tiers
      WHERE season_id IS NULL AND axis = $1
      ORDER BY sort_order ASC;
      `,
      [axis]
    );
    return rows.map(mapRow);
  },

  /**
   * Resolve the asset IDs referenced across a set of bundles into display data
   * (image_url, name, etc.) for the rewards modal. Batched: one query per asset
   * type for all ids. Missing ids are simply omitted.
   */
  async resolveAssetsForBundles(
    bundles: SeasonRewardBundle[],
    executor: QueryExecutor = db
  ): Promise<{
    cards: Map<string, ResolvedRewardCard>;
    borders: Map<string, ResolvedRewardBorder>;
    cardBacks: Map<string, ResolvedRewardCardBack>;
  }> {
    const variantIds = new Set<string>();
    const borderIds = new Set<string>();
    const backIds = new Set<string>();
    for (const b of bundles) {
      b.card_variant_ids.forEach((id) => variantIds.add(id));
      b.border_ids.forEach((id) => borderIds.add(id));
      b.card_back_ids.forEach((id) => backIds.add(id));
    }

    const cards = new Map<string, ResolvedRewardCard>();
    const borders = new Map<string, ResolvedRewardBorder>();
    const cardBacks = new Map<string, ResolvedRewardCardBack>();

    if (variantIds.size > 0) {
      const { rows } = await executor.query(
        `SELECT cv.card_variant_id, cv.image_url, cv.rarity,
                ch.character_id AS base_card_id, ch.name
         FROM card_variants cv
         JOIN characters ch ON ch.character_id = cv.character_id
         WHERE cv.card_variant_id = ANY($1::uuid[]);`,
        [[...variantIds]]
      );
      for (const r of rows) {
        cards.set(r.card_variant_id, {
          card_variant_id: r.card_variant_id,
          base_card_id: r.base_card_id,
          name: r.name,
          rarity: r.rarity,
          image_url: r.image_url,
        });
      }
    }

    if (borderIds.size > 0) {
      const { rows } = await executor.query(
        `SELECT border_id, name, image_url, animation_key
         FROM card_borders
         WHERE border_id = ANY($1::uuid[]);`,
        [[...borderIds]]
      );
      for (const r of rows) {
        borders.set(r.border_id, {
          border_id: r.border_id,
          name: r.name,
          image_url: r.image_url,
          animation_key: r.animation_key ?? null,
        });
      }
    }

    if (backIds.size > 0) {
      const { rows } = await executor.query(
        `SELECT back_id, name, image_url
         FROM card_backs
         WHERE back_id = ANY($1::uuid[]);`,
        [[...backIds]]
      );
      for (const r of rows) {
        cardBacks.set(r.back_id, {
          back_id: r.back_id,
          name: r.name,
          image_url: r.image_url,
        });
      }
    }

    return { cards, borders, cardBacks };
  },
};

function mapRow(row: Record<string, unknown>): SeasonRewardTierRow {
  return {
    id: row.id as string,
    season_id: (row.season_id as string | null) ?? null,
    axis: row.axis as SeasonRewardAxis,
    tier_key: row.tier_key as string,
    sort_order: Number(row.sort_order),
    label: row.label as string,
    threshold_kind: row.threshold_kind as "exact_rank" | "percentile",
    threshold_value: Number(row.threshold_value),
    bundle_json: normalizeBundle(row.bundle_json),
    created_at: row.created_at as Date,
    updated_at: row.updated_at as Date,
  };
}

/** Defensive normalization so partially-populated bundles never crash callers. */
function normalizeBundle(raw: unknown): SeasonRewardBundle {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const display = (b.display && typeof b.display === "object"
    ? b.display
    : {}) as Record<string, unknown>;
  return {
    gems: Number(b.gems) || 0,
    packs: Number(b.packs) || 0,
    card_variant_ids: asStringArray(b.card_variant_ids),
    border_ids: asStringArray(b.border_ids),
    card_back_ids: asStringArray(b.card_back_ids),
    display: {
      card_count: Number(display.card_count) || 0,
      card_label:
        typeof display.card_label === "string" ? display.card_label : null,
      cosmetic_labels: asStringArray(display.cosmetic_labels),
    },
  };
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Given an ordered (prestige-first) tier list, the player's 1-based rank, and
 * the total number of ranked players, return the single tier the player falls
 * into (non-cumulative). Returns null when no tier matches (shouldn't happen if
 * a catch-all percentile=100 tier exists).
 *
 * Tiers are evaluated highest-first; the first matching tier wins, so narrower
 * tiers (e.g. exact rank #1) must sort before broader percentile tiers.
 */
export function resolveTierForRank(
  tiers: SeasonRewardTierRow[],
  rank: number,
  totalRanked: number
): SeasonRewardTierRow | null {
  if (rank < 1 || totalRanked < 1) return null;
  for (const tier of tiers) {
    if (tier.threshold_kind === "exact_rank") {
      if (rank <= tier.threshold_value) return tier;
    } else {
      // percentile: top N% — at least one player always qualifies for any
      // percentile > 0 via the ceil (so percentile=100 covers everyone).
      const cutoff = Math.max(1, Math.ceil((tier.threshold_value / 100) * totalRanked));
      if (rank <= cutoff) return tier;
    }
  }
  return null;
}

/**
 * Resolve the pantheon-axis tier for a pantheon's placement in the faction
 * race (1 = winning pantheon, 2 = second, ...). Pantheon tiers use exact_rank
 * thresholds against the placement. Returns the first tier whose threshold
 * covers the placement, or null when the placement is outside all tiers.
 */
export function resolvePantheonTier(
  tiers: SeasonRewardTierRow[],
  placement: number
): SeasonRewardTierRow | null {
  if (placement < 1) return null;
  // Prefer the most specific (lowest threshold) match. With per-placement rows
  // (threshold 1, 2, 3) an exact match wins; a "≤ N" style row still resolves.
  let best: SeasonRewardTierRow | null = null;
  for (const tier of tiers) {
    if (tier.threshold_kind !== "exact_rank") continue;
    if (placement <= tier.threshold_value) {
      if (!best || tier.threshold_value < best.threshold_value) best = tier;
    }
  }
  return best;
}

export default SeasonRewardTierModel;
