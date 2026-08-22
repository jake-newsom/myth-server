/**
 * PvP rank ladder — the single source of truth for rank names, bands and
 * divisions. Both the ranking math and the client's badge lookup key off the
 * `key` values here, so nothing else should hardcode a rank name.
 *
 * Two kinds of rank:
 *
 *  - EARNED ranks are pure rating bands. You reach one by crossing a number
 *    and you keep it for the season; they never decay. Each is split into
 *    three evenly-sized divisions (III -> II -> I) so there is a visible step
 *    roughly every ~80 rating instead of one flat 250-point plateau.
 *
 *  - POSITIONAL ranks are held by ladder position, not rating, so they stay
 *    scarce no matter how much rating inflates over a season. They require the
 *    top earned rank as a floor, have no divisions, and DO decay (see
 *    POSITIONAL_DECAY_DAYS) so an inactive player cannot squat a top slot.
 */

export type PvpRankKind = "earned" | "positional";

export interface PvpRank {
  /** Stable identifier. Used by the client for icon lookup — never rename. */
  key: string;
  label: string;
  kind: PvpRankKind;
  /** Ascending; higher is better. Also the sprite-sheet cell order. */
  order: number;
  /** Earned ranks: inclusive rating floor. */
  minRating: number;
  /** Earned ranks: inclusive rating ceiling. Infinity for the top band. */
  maxRating: number;
  /** Positional ranks: held by the top N of the ladder. */
  maxRankPosition?: number;
  /**
   * Positional ranks: held by the top fraction of players who cleared the
   * rank's rating floor. Scales with the ladder instead of a fixed bracket, so
   * the rank stays scarce as the base grows. Ignored when maxRankPosition is set.
   */
  topFraction?: number;
  /**
   * Minimum number of players above the floor before a `topFraction` rank is
   * awarded at all. A percentile of a tiny pool is noise, so below this nobody
   * holds the rank.
   */
  minPoolSize?: number;
  /** Earned ranks are split into this many divisions (III..I). */
  divisions: number;
  /** One-line flavour + rule, shown in the ranks info modal. */
  description: string;
}

/**
 * Rating at which Immortal begins, and the floor every positional rank sits on.
 *
 * Calibrated to how ratings ACTUALLY move in this ladder, not to a mature one.
 * Elo is zero-sum against same-rated opponents, so ratings plateau: a 70% player
 * converges near 1150 and stays there however long they play, and even an
 * undefeated 100-game run lands around 1500. The previous 2100 floor was set for
 * a large, spread-out ladder and was unreachable here — which left every rank
 * above it permanently empty.
 *
 * Expect to RAISE this as the player base grows and ratings spread out.
 */
export const IMMORTAL_FLOOR = 1425;

export const PVP_RANKS: PvpRank[] = [
  { key: "seeker",     label: "Seeker",     kind: "earned", order: 1, minRating: 0,    maxRating: 1049,     divisions: 3, description: "Where every contender begins. You have tasted victory; the gods have not yet looked your way." },
  { key: "champion",   label: "Champion",   kind: "earned", order: 2, minRating: 1050, maxRating: 1149,     divisions: 3, description: "A proven fighter. Your name is starting to carry beyond your own hall." },
  { key: "chosen",     label: "Chosen",     kind: "earned", order: 3, minRating: 1150, maxRating: 1274,     divisions: 3, description: "Marked by a god. Your victories are no longer your own — something is watching." },
  { key: "ascendant",  label: "Ascendant",  kind: "earned", order: 4, minRating: 1275, maxRating: 1424,     divisions: 3, description: "You are shedding the mortal. The pantheons argue over which of them claims you." },
  { key: "immortal",   label: "Immortal",   kind: "earned", order: 5, minRating: IMMORTAL_FLOOR, maxRating: Infinity, divisions: 3, description: "The highest rank that can be earned outright. Hold this rating and it is yours." },
  { key: "titan",      label: "Titan",      kind: "positional", order: 6, minRating: IMMORTAL_FLOOR, maxRating: Infinity, topFraction: 0.1, minPoolSize: 15, divisions: 0, description: "The top tenth of those who reached Immortal. Lost after 7 days without a ranked game." },
  { key: "worldforger",label: "Worldforger",kind: "positional", order: 7, minRating: IMMORTAL_FLOOR, maxRating: Infinity, maxRankPosition: 3, divisions: 0, description: "The top three. Lost after 7 days without a ranked game." },
  { key: "zenith",     label: "Zenith",     kind: "positional", order: 8, minRating: IMMORTAL_FLOOR, maxRating: Infinity, maxRankPosition: 1, divisions: 0, description: "One player. Lost after 7 days without a ranked game." },
];

/** Rating every new season starts from. */
export const PVP_BASE_RATING = 1000;

/**
 * Season-end soft reset: new = BASE + (old - BASE) * FACTOR, then capped.
 *
 * A hard wipe to BASE is what the ladder does today and it erases a whole
 * season of progress overnight; carrying 100% would leave the ladder frozen.
 * 40% re-climbs in roughly a fortnight of regular play while still reshuffling
 * the standings.
 */
export const PVP_SOFT_RESET_FACTOR = 0.4;

/** No soft-reset result may exceed this — the top of Chosen. */
export const PVP_SOFT_RESET_CEILING = 1599;

/** Games at the doubled placement K-factor before ratings settle. */
export const PVP_PLACEMENT_GAMES = 5;
export const PVP_PLACEMENT_K_FACTOR = 64;
export const PVP_STANDARD_K_FACTOR = 32;

/** Days of inactivity before a positional rank is released. */
export const POSITIONAL_DECAY_DAYS = 7;

/** Ranked games required in a season to be paid out. */
export const PVP_MIN_GAMES_FOR_REWARDS = 10;

const EARNED_RANKS = PVP_RANKS.filter((r) => r.kind === "earned");

export function getRankByKey(key: string): PvpRank | undefined {
  return PVP_RANKS.find((r) => r.key === key);
}

/** The earned rank a rating falls into. Never returns a positional rank. */
export function earnedRankForRating(rating: number): PvpRank {
  const clamped = Math.max(0, rating);
  return (
    EARNED_RANKS.find((r) => clamped >= r.minRating && clamped <= r.maxRating) ??
    EARNED_RANKS[0]
  );
}

/**
 * Division within an earned rank, 1 (best) .. divisions (worst).
 *
 * The top band is unbounded, so it has no meaningful width to divide; everyone
 * in it sits in division I.
 */
export function divisionForRating(rating: number, rank = earnedRankForRating(rating)): number {
  if (rank.divisions <= 0) return 0;
  if (!Number.isFinite(rank.maxRating)) return 1;

  const width = (rank.maxRating + 1 - rank.minRating) / rank.divisions;
  const stepsFromFloor = Math.floor((rating - rank.minRating) / width);
  const step = Math.min(rank.divisions - 1, Math.max(0, stepsFromFloor));
  // Divisions count DOWN as rating rises: the lowest slice is III, top is I.
  return rank.divisions - step;
}

export const DIVISION_NUMERALS = ["", "I", "II", "III"] as const;

/**
 * Full rank for a player, taking ladder position into account.
 *
 * `rankPosition` is 1-based; pass undefined when it is unknown (e.g. a single
 * player lookup that did not compute standings) and only earned ranks apply.
 */
export function resolveRank(params: {
  rating: number;
  rankPosition?: number | null;
  lastGameAt?: Date | string | null;
  now?: Date;
  /**
   * How many players currently sit above the positional floor. Required for
   * `topFraction` ranks; without it only fixed-bracket ranks can be awarded,
   * which is the safe answer for callers that never computed standings.
   */
  poolSize?: number | null;
}): { rank: PvpRank; division: number; label: string } {
  const { rating, rankPosition, lastGameAt, now = new Date(), poolSize } = params;
  const earned = earnedRankForRating(rating);

  const positional = [...PVP_RANKS]
    .filter((r) => r.kind === "positional")
    // Best rank first, so a player who qualifies for several gets the highest.
    // Sorted by `order`, NOT by bracket size: with a proportional bracket the
    // two can disagree (a 10% Titan slice of 20 players is 2, narrower than
    // Worldforger's fixed 3), which would hand the better rank to worse players.
    .sort((a, b) => b.order - a.order);

  if (rankPosition && rating >= earned.minRating) {
    for (const rank of positional) {
      const bracket = positionalBracket(rank, poolSize);
      const withinBracket = bracket > 0 && rankPosition <= bracket;
      const meetsFloor = rating >= rank.minRating;
      if (withinBracket && meetsFloor && !hasDecayed(lastGameAt, now)) {
        return { rank, division: 0, label: rank.label };
      }
    }
  }

  const division = divisionForRating(rating, earned);
  return {
    rank: earned,
    division,
    label: division ? `${earned.label} ${DIVISION_NUMERALS[division]}` : earned.label,
  };
}

/**
 * How many players hold a positional rank, resolved against the current pool.
 *
 * Returns 0 when the rank cannot be awarded: a `topFraction` rank with no known
 * pool, or a pool below its `minPoolSize`. Fixed `maxRankPosition` brackets are
 * returned as-is and never depend on the pool.
 */
export function positionalBracket(
  rank: PvpRank,
  poolSize?: number | null
): number {
  if (rank.maxRankPosition) return rank.maxRankPosition;
  if (!rank.topFraction) return 0;
  if (poolSize == null) return 0;
  if (rank.minPoolSize != null && poolSize < rank.minPoolSize) return 0;
  // At least one holder once the pool qualifies, so a 10% slice of 15 is not 1.5.
  return Math.max(1, Math.floor(poolSize * rank.topFraction));
}

/** True once a positional holder has been idle past the decay window. */
export function hasDecayed(
  lastGameAt: Date | string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!lastGameAt) return true;
  const last = lastGameAt instanceof Date ? lastGameAt : new Date(lastGameAt);
  if (Number.isNaN(last.getTime())) return true;
  const days = (now.getTime() - last.getTime()) / 86_400_000;
  return days > POSITIONAL_DECAY_DAYS;
}

/** K-factor for a player's next game, doubled while still in placements. */
export function kFactorForGamesPlayed(gamesPlayed: number): number {
  return gamesPlayed < PVP_PLACEMENT_GAMES
    ? PVP_PLACEMENT_K_FACTOR
    : PVP_STANDARD_K_FACTOR;
}

/**
 * Progress toward the next rank, in PvP rank terms.
 *
 * Mirrors the legacy tier-based `calculateRankProgress` but speaks the rank
 * ladder, so the client never has to render "Progress to Silver" next to a
 * Demigod badge.
 *
 * Positional ranks are deliberately NOT treated as "next": you cannot grind a
 * rating number to reach them, so showing a rating goal for Titan would be
 * a lie. A player in the top earned rank is simply complete.
 */
export function rankProgressFor(rating: number): {
  current_rank_key: string;
  current_rank_label: string;
  next_rank_key: string | null;
  next_rank_label: string | null;
  rating_needed: number | null;
  progress_percentage: number;
} {
  const current = earnedRankForRating(rating);
  const next = EARNED_RANKS.find((r) => r.order === current.order + 1) ?? null;

  if (!next) {
    return {
      current_rank_key: current.key,
      current_rank_label: current.label,
      next_rank_key: null,
      next_rank_label: null,
      rating_needed: null,
      progress_percentage: 100,
    };
  }

  const span = next.minRating - current.minRating;
  const gained = rating - current.minRating;
  const pct = span > 0 ? Math.round((gained / span) * 100) : 0;

  return {
    current_rank_key: current.key,
    current_rank_label: current.label,
    next_rank_key: next.key,
    next_rank_label: next.label,
    rating_needed: Math.max(0, next.minRating - rating),
    progress_percentage: Math.max(0, Math.min(100, pct)),
  };
}

/**
 * Bucket a set of ratings into rank counts, ordered strongest-first.
 *
 * Used for the ladder's distribution chart. Only earned ranks appear —
 * positional ranks are a slice of the top band, not a separate population, so
 * counting them separately would double-count those players.
 */
export function rankDistribution(
  ratings: number[]
): Array<{ key: string; label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const rating of ratings) {
    const rank = earnedRankForRating(rating);
    counts.set(rank.key, (counts.get(rank.key) ?? 0) + 1);
  }
  return [...EARNED_RANKS]
    .sort((a, b) => b.order - a.order)
    .map((r) => ({ key: r.key, label: r.label, count: counts.get(r.key) ?? 0 }));
}

/** Rating a player carries into the next season. */
export function softResetRating(oldRating: number): number {
  const carried =
    PVP_BASE_RATING + (oldRating - PVP_BASE_RATING) * PVP_SOFT_RESET_FACTOR;
  return Math.max(0, Math.min(PVP_SOFT_RESET_CEILING, Math.round(carried)));
}
