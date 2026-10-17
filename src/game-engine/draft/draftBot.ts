/**
 * The Ranked Draft practice bot's drafting brain.
 *
 * Pure: no database, no clock, injectable randomness. The orchestrator adapts
 * a live session into a DraftBotView; the offline sim (sim/cli/draft-match.ts)
 * builds the same view from its own simulated drafts, so the logic measured
 * offline is exactly the logic that runs live.
 *
 * Card strength comes from a value table learned by simulation
 * (content/ai/draft-card-values.json, built by sim/cli/draft-values.ts): one
 * number per character, in win-logit units, that already prices in what the
 * ability does through the real engine. Cards missing from the table (new
 * releases) fall back to a stat-based estimate fitted to that same table.
 */

export interface DraftPower {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface DraftPoolCard {
  cardVariantId: string;
  name: string;
  /** Base rarity (no "+"), lower-case. */
  rarity: string;
  /** Draft budget cost (RARITY_POWER_COST). */
  cost: number;
  power: DraftPower;
}

export interface DraftValueFallback {
  intercept: number;
  perStat: number;
  perMinSide: number;
}

export interface DraftValueTable {
  version: number;
  /** Lower-cased character name -> learned value. */
  values: Record<string, number>;
  fallback: DraftValueFallback;
}

/** Roughly "rank by stat total", used only when no learned table is loaded. */
export const DEFAULT_FALLBACK: DraftValueFallback = {
  intercept: -2,
  perStat: 0.08,
  perMinSide: 0.04,
};

export function statTotal(p: DraftPower): number {
  return p.top + p.right + p.bottom + p.left;
}

export function minSide(p: DraftPower): number {
  return Math.min(p.top, p.right, p.bottom, p.left);
}

export function cardValue(
  card: DraftPoolCard,
  table: DraftValueTable | null
): number {
  const learned = table?.values[card.name.toLowerCase()];
  if (typeof learned === "number" && Number.isFinite(learned)) return learned;
  const f = table?.fallback ?? DEFAULT_FALLBACK;
  return (
    f.intercept +
    f.perStat * statTotal(card.power) +
    f.perMinSide * minSide(card.power)
  );
}

/** Everything the bot may know when it acts. Never includes hidden info. */
export interface DraftBotView {
  /** The full draftable pool (original printings). */
  pool: DraftPoolCard[];
  /** Banned or already drafted by anyone. */
  unavailable: Set<string>;
  myPicks: string[];
  opponentPicks: string[];
  budgetTotal: number;
  picksTotal: number;
  /**
   * How often players draft each card, 0..1 relative to the most-drafted card
   * (absent or empty = no data). Public knowledge, not hidden info. Ban and
   * block lean toward popular cards; picks ignore it.
   */
  usage?: ReadonlyMap<string, number>;
}

export interface DraftBotOptions {
  table: DraftValueTable | null;
  /**
   * 0..1 — chance each ban, pick and block uses the bot's real judgement.
   * Otherwise it takes the naive choice (highest stat total it can afford,
   * which is also what the timeout auto-pick does). This is the difficulty
   * knob. Measured in sim (draft-match.ts, bot drafting second, live AI
   * playing both decks, 400 games each) against a casual stat-minded drafter:
   * strength 0 → 46%, 0.25 → 63%, 0.6 → 79%, 1 → 94%.
   */
  strength: number;
  /**
   * Variety among near-equal candidates. 0 = always the best-scoring one;
   * higher = more willing to take a near-best one. Scaled by the spread of
   * the top scores. Barely moves strength (sim: 0 vs 1.5 within noise), so it
   * is used for variety only, never as difficulty.
   */
  looseness: number;
  rand: () => number;
  /**
   * Per-draft "taste": when set, each card's value gets a stable bias of up
   * to ±TASTE_AMPLITUDE derived from (seed, card name). Live uses the session
   * id, so one draft's ban, picks and block share a coherent personality
   * while different drafts lean toward different cards.
   */
  tasteSeed?: string;
}

/** Variety setting used live. */
export const LIVE_LOOSENESS = 1.0;

/** Max taste bias, in learned-value units (values span about -0.25..0.85). */
export const TASTE_AMPLITUDE = 0.1;

/** How many of the top-scoring candidates the softmax may choose among. */
const SOFTMAX_TOP_K = 5;
/** Candidates the naive (stat-total) pick chooses among when loose. */
const NAIVE_TOP_K = 6;
/** Candidates a loose ban chooses among. */
const BAN_TOP_K = 3;

/** Stable bias in [-TASTE_AMPLITUDE, TASTE_AMPLITUDE] for (seed, name). */
export function tasteBias(seed: string | undefined, name: string): number {
  if (!seed) return 0;
  // FNV-1a, 32-bit.
  let h = 0x811c9dc5;
  const key = `${seed}:${name.toLowerCase()}`;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) / 0xffffffff * 2 - 1) * TASTE_AMPLITUDE;
}

/**
 * Ranked rating → strength. At or below the 1000 starting rating the bot's
 * deck is about as good as a casual drafter's (new players are who this mode
 * exists for); full strength at 1400 and up. Tune from the
 * "[rankedDraftBot] practice draft difficulty" / "bot game rated" logs.
 */
export const MIN_STRENGTH = 0.1;
export function strengthForRating(rating: number): number {
  const LOW = 1000;
  const HIGH = 1400;
  if (rating <= LOW) return MIN_STRENGTH;
  if (rating >= HIGH) return 1;
  return MIN_STRENGTH + ((1 - MIN_STRENGTH) * (rating - LOW)) / (HIGH - LOW);
}

function costOf(view: DraftBotView, ids: string[]): number {
  const byId = new Map(view.pool.map((c) => [c.cardVariantId, c]));
  return ids.reduce((sum, id) => sum + (byId.get(id)?.cost ?? 0), 0);
}

/**
 * Best total value from choosing exactly `slots` cards whose costs fit in
 * `budget`. Cardinality-constrained 0/1 knapsack; the pool is ~90 cards and
 * the budget 50, so this is ~50k steps.
 *
 * Returns -Infinity when the slots cannot be filled at all.
 */
export function bestFill(
  cards: { cost: number; value: number }[],
  budget: number,
  slots: number
): number {
  if (slots <= 0) return 0;
  const B = Math.max(0, Math.floor(budget));
  // dp[j][b]: best value using j cards with total cost <= b.
  const dp: Float64Array[] = [];
  for (let j = 0; j <= slots; j++) {
    dp.push(new Float64Array(B + 1).fill(j === 0 ? 0 : -Infinity));
  }
  for (const card of cards) {
    const c = card.cost;
    if (c > B) continue;
    for (let j = slots; j >= 1; j--) {
      const prev = dp[j - 1];
      const cur = dp[j];
      for (let b = B; b >= c; b--) {
        const cand = prev[b - c] + card.value;
        if (cand > cur[b]) cur[b] = cand;
      }
    }
  }
  return dp[slots][B];
}

/**
 * The cards the opponent is assumed to take before we can: their best
 * affordable cards, greedily, one per pick they still owe. Pessimistic on
 * purpose — it is what makes the bot grab a contested card now rather than
 * plan around one that will not be there.
 */
function expectedOpponentTakes(
  available: { card: DraftPoolCard; value: number }[],
  opponentBudgetLeft: number,
  opponentPicksLeft: number
): Set<string> {
  const taken = new Set<string>();
  let budget = opponentBudgetLeft;
  for (const entry of [...available].sort((a, b) => b.value - a.value)) {
    if (taken.size >= opponentPicksLeft) break;
    if (entry.card.cost > budget) continue;
    taken.add(entry.card.cardVariantId);
    budget -= entry.card.cost;
  }
  return taken;
}

export interface ScoredCandidate {
  cardVariantId: string;
  score: number;
  value: number;
}

/**
 * Scores every legal pick: its own value plus the best value the remaining
 * slots can still reach under the budget it leaves. That second term is what
 * paces the budget — a legendary that would force the rest of the deck into
 * commons scores below a cheaper card that keeps good options open.
 */
export function scorePicks(
  view: DraftBotView,
  table: DraftValueTable | null,
  tasteSeed?: string
): ScoredCandidate[] {
  const myBudgetLeft = view.budgetTotal - costOf(view, view.myPicks);
  const mySlotsAfter = view.picksTotal - view.myPicks.length - 1;
  const oppBudgetLeft = view.budgetTotal - costOf(view, view.opponentPicks);
  const oppPicksLeft = view.picksTotal - view.opponentPicks.length;

  const available = view.pool
    .filter((c) => !view.unavailable.has(c.cardVariantId))
    .map((card) => ({
      card,
      value: cardValue(card, table) + tasteBias(tasteSeed, card.name),
    }));

  const scored: ScoredCandidate[] = [];
  for (const cand of available) {
    if (cand.card.cost > myBudgetLeft) continue;
    const rest = available.filter(
      (e) => e.card.cardVariantId !== cand.card.cardVariantId
    );
    const oppTakes = expectedOpponentTakes(rest, oppBudgetLeft, oppPicksLeft);
    const future = bestFill(
      rest
        .filter((e) => !oppTakes.has(e.card.cardVariantId))
        .map((e) => ({ cost: e.card.cost, value: e.value })),
      myBudgetLeft - cand.card.cost,
      mySlotsAfter
    );
    // An unfillable future can't happen with free commons in the pool, but
    // never let it rank a candidate above a fillable one.
    const score = Number.isFinite(future) ? cand.value + future : -1e9 + cand.value;
    scored.push({ cardVariantId: cand.card.cardVariantId, score, value: cand.value });
  }
  scored.sort(
    (a, b) => b.score - a.score || a.cardVariantId.localeCompare(b.cardVariantId)
  );
  return scored;
}

/**
 * Picks among the top candidates. looseness 0 is a pure argmax; otherwise a
 * softmax whose temperature is looseness × the spread of the top scores.
 */
function choose(
  scored: { cardVariantId: string; score: number }[],
  looseness: number,
  rand: () => number,
  topK = SOFTMAX_TOP_K
): string | null {
  if (scored.length === 0) return null;
  const top = scored.slice(0, topK);
  if (looseness <= 0.01 || top.length === 1) return top[0].cardVariantId;

  const mean = top.reduce((s, c) => s + c.score, 0) / top.length;
  const spread = Math.sqrt(
    top.reduce((s, c) => s + (c.score - mean) ** 2, 0) / top.length
  );
  const temperature = looseness * Math.max(spread, 0.05);
  const best = top[0].score;
  const weights = top.map((c) => Math.exp((c.score - best) / temperature));
  const total = weights.reduce((s, w) => s + w, 0);
  let roll = rand() * total;
  for (let i = 0; i < top.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return top[i].cardVariantId;
  }
  return top[top.length - 1].cardVariantId;
}

/** Highest stat total the bot can afford; ties on id (= chooseAutoPick). */
export function naivePick(view: DraftBotView): string | null {
  const left = view.budgetTotal - costOf(view, view.myPicks);
  let best: DraftPoolCard | null = null;
  for (const card of view.pool) {
    if (view.unavailable.has(card.cardVariantId) || card.cost > left) continue;
    if (
      !best ||
      statTotal(card.power) > statTotal(best.power) ||
      (statTotal(card.power) === statTotal(best.power) &&
        card.cardVariantId < best.cardVariantId)
    ) {
      best = card;
    }
  }
  return best?.cardVariantId ?? null;
}

/**
 * naivePick with variety: a softmax over the highest-stat affordable cards.
 * looseness 0 is exactly naivePick.
 */
export function looseNaivePick(
  view: DraftBotView,
  looseness: number,
  rand: () => number
): string | null {
  if (looseness <= 0.01) return naivePick(view);
  const left = view.budgetTotal - costOf(view, view.myPicks);
  const scored = view.pool
    .filter((c) => !view.unavailable.has(c.cardVariantId) && c.cost <= left)
    .map((c) => ({ cardVariantId: c.cardVariantId, score: statTotal(c.power) }))
    .sort(
      (a, b) => b.score - a.score || a.cardVariantId.localeCompare(b.cardVariantId)
    );
  return choose(scored, looseness, rand, NAIVE_TOP_K);
}

export function chooseBotPick(
  view: DraftBotView,
  opts: DraftBotOptions
): string | null {
  if (opts.rand() >= opts.strength) {
    const naive = looseNaivePick(view, opts.looseness, opts.rand);
    if (naive) return naive;
  }
  return choose(
    scorePicks(view, opts.table, opts.tasteSeed),
    opts.looseness,
    opts.rand
  );
}

/**
 * Ban/block score bonus for the most-drafted card (scaled down linearly for
 * less popular ones), in learned-value units: values span about -0.25..0.85,
 * so 0.3 lets a popular card beat a slightly stronger unpopular one without
 * ever making the bot spend a ban on a weak card just because it is common.
 */
export const USAGE_WEIGHT = 0.3;

function banBlockScore(
  card: DraftPoolCard,
  view: DraftBotView,
  table: DraftValueTable | null,
  tasteSeed?: string
): number {
  return (
    cardValue(card, table) +
    tasteBias(tasteSeed, card.name) +
    USAGE_WEIGHT * (view.usage?.get(card.cardVariantId) ?? 0)
  );
}

/** Below full strength, ban/block also fall back to the naive stat choice. */
type JudgementOptions = Pick<DraftBotOptions, "table"> &
  Partial<Pick<DraftBotOptions, "strength" | "rand" | "tasteSeed">> & {
    /** Bans only (blocks stay argmax): variety among the top few. Default 0. */
    looseness?: number;
  };

function usesJudgement(opts: JudgementOptions): boolean {
  const strength = opts.strength ?? 1;
  return strength >= 1 || (opts.rand ?? Math.random)() < strength;
}

function highestStat(cards: DraftPoolCard[]): string | null {
  let best: DraftPoolCard | null = null;
  for (const card of cards) {
    if (
      !best ||
      statTotal(card.power) > statTotal(best.power) ||
      (statTotal(card.power) === statTotal(best.power) &&
        card.cardVariantId < best.cardVariantId)
    ) {
      best = card;
    }
  }
  return best?.cardVariantId ?? null;
}

/**
 * Bans the strongest card in the pool, leaning toward popular ones. The human
 * always drafts first in a practice draft, so this removes the card they would
 * most likely open on.
 */
export function chooseBotBan(
  view: DraftBotView,
  opts: JudgementOptions
): string | null {
  const looseness = opts.looseness ?? 0;
  const rand = opts.rand ?? Math.random;
  if (!usesJudgement(opts)) return looseNaivePick(view, looseness, rand);
  const scored = view.pool
    .filter((c) => !view.unavailable.has(c.cardVariantId))
    .map((c) => ({
      cardVariantId: c.cardVariantId,
      score: banBlockScore(c, view, opts.table, opts.tasteSeed),
    }))
    .sort(
      (a, b) => b.score - a.score || a.cardVariantId.localeCompare(b.cardVariantId)
    );
  return choose(scored, looseness, rand, BAN_TOP_K);
}

/** Blocks the opponent's strongest drafted card, leaning toward popular ones. */
export function chooseBotBlock(
  view: DraftBotView,
  opts: JudgementOptions
): string | null {
  const byId = new Map(view.pool.map((c) => [c.cardVariantId, c]));
  if (!usesJudgement(opts)) {
    const theirs = view.opponentPicks
      .map((id) => byId.get(id))
      .filter((c): c is DraftPoolCard => !!c);
    return highestStat(theirs) ?? view.opponentPicks[0] ?? null;
  }
  let best: { id: string; value: number } | null = null;
  for (const id of view.opponentPicks) {
    const card = byId.get(id);
    if (!card) continue;
    const value = banBlockScore(card, view, opts.table, opts.tasteSeed);
    if (!best || value > best.value || (value === best.value && id < best.id)) {
      best = { id, value };
    }
  }
  return best?.id ?? view.opponentPicks[0] ?? null;
}
