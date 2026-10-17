/**
 * Headless Ranked Draft: the same ban → 1-2-2…-1 picks → block flow as a live
 * session, run in memory so drafting strategies can be measured by playing
 * the decks they produce.
 */
import { InGameCard } from "../../types/card.types";
import { RANKED_DRAFT_CONFIG, RARITY_POWER_COST } from "../../config/constants";
import { DeckSnapshot } from "./sim.types";
import {
  DraftBotView,
  DraftPoolCard,
  DraftValueTable,
  chooseBotBan,
  chooseBotBlock,
  chooseBotPick,
  statTotal,
} from "../draft/draftBot";

/** Produced by sim/cli/export-draft-pool.ts. */
export interface DraftPoolSnapshot {
  exported_at: string;
  source_db: string;
  /** One level-1 card per draftable original printing. */
  cards: InGameCard[];
}

export function baseRarityOf(rarity: string): string {
  return (rarity || "").replace(/\+/g, "").toLowerCase();
}

export function toPoolCard(card: InGameCard): DraftPoolCard {
  const rarity = baseRarityOf(card.base_card_data.rarity);
  const cost = RARITY_POWER_COST[rarity];
  if (cost === undefined) throw new Error(`no draft cost for rarity ${rarity}`);
  return {
    cardVariantId: card.base_card_id,
    name: card.base_card_data.name,
    rarity,
    cost,
    power: { ...card.base_card_data.base_power },
  };
}

/** A drafted deck as the sim plays it: every pick twice, like the live game. */
export function draftDeckSnapshot(
  name: string,
  picks: string[],
  cardsById: Map<string, InGameCard>
): DeckSnapshot {
  const cards: InGameCard[] = [];
  for (const id of picks) {
    const card = cardsById.get(id);
    if (!card) throw new Error(`draft pick ${id} not in pool`);
    for (let copy = 0; copy < RANKED_DRAFT_CONFIG.COPIES_PER_PICK; copy++) {
      cards.push(card);
    }
  }
  return { deck_id: name, name, source: "player", deck_effect: null, cards };
}

export interface SimDrafter {
  readonly name: string;
  ban(view: DraftBotView): string | null;
  pick(view: DraftBotView): string | null;
  block(view: DraftBotView): string | null;
}

/** The practice bot, exactly as the orchestrator runs it. */
export function botDrafter(
  table: DraftValueTable | null,
  strength: number,
  looseness: number,
  rand: () => number,
  name = "bot",
  usage?: ReadonlyMap<string, number>,
  /** Live-like variety: loose bans + a fresh taste seed each draft. */
  taste = false
): SimDrafter {
  const withUsage = (v: DraftBotView): DraftBotView =>
    usage ? { ...v, usage } : v;
  let tasteSeed: string | undefined;
  // Ban is each draft's first bot action, so a new seed there = per-draft taste.
  return {
    name,
    ban: (v) => {
      if (taste) tasteSeed = rand().toString(36);
      return chooseBotBan(withUsage(v), {
        table, strength, rand, tasteSeed, looseness: taste ? looseness : 0,
      });
    },
    pick: (v) => chooseBotPick(v, { table, strength, looseness, rand, tasteSeed }),
    block: (v) => chooseBotBlock(withUsage(v), { table, strength, rand, tasteSeed }),
  };
}

/**
 * Stand-in for live draft popularity when no real counts are at hand: how
 * often casual stat-minded drafters (noisyAutoDrafter) take each card over
 * many simulated drafts, as 0..1 of the most-taken card.
 */
export function casualUsage(
  pool: DraftPoolCard[],
  drafts: number,
  rand: () => number
): Map<string, number> {
  const counts = new Map<string, number>();
  const a = noisyAutoDrafter(rand);
  const b = noisyAutoDrafter(rand);
  for (let i = 0; i < drafts; i++) {
    const r = simulateDraft(pool, a, b);
    for (const id of [...r.p1Picks, ...r.p2Picks]) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  const max = Math.max(1, ...counts.values());
  return new Map([...counts].map(([id, n]) => [id, n / max]));
}

/**
 * Mirrors rankedDraft.service chooseAutoPick / chooseAutoBlock: highest stat
 * total the player can afford, ties on id. The ban-phase timeout also uses
 * chooseAutoPick, so the ban matches too.
 */
export function autoDrafter(): SimDrafter {
  const best = (cards: DraftPoolCard[]) =>
    [...cards].sort(
      (a, b) =>
        statTotal(b.power) - statTotal(a.power) ||
        a.cardVariantId.localeCompare(b.cardVariantId)
    )[0]?.cardVariantId ?? null;
  const spent = (v: DraftBotView) => {
    const byId = new Map(v.pool.map((c) => [c.cardVariantId, c]));
    return v.myPicks.reduce((s, id) => s + (byId.get(id)?.cost ?? 0), 0);
  };
  const affordable = (v: DraftBotView) =>
    v.pool.filter(
      (c) =>
        !v.unavailable.has(c.cardVariantId) &&
        c.cost <= v.budgetTotal - spent(v)
    );
  return {
    name: "auto",
    ban: (v) => best(affordable(v)),
    pick: (v) => best(affordable(v)),
    block: (v) =>
      best(v.pool.filter((c) => v.opponentPicks.includes(c.cardVariantId))),
  };
}

/**
 * A stat-minded drafter with some variety: uniformly one of its top 3 stat
 * totals. Stands in for a casual human in calibration runs — unlike
 * autoDrafter it doesn't produce the same draft every time.
 */
export function noisyAutoDrafter(rand: () => number): SimDrafter {
  const topThree = (cards: DraftPoolCard[]) => {
    const top = [...cards]
      .sort(
        (a, b) =>
          statTotal(b.power) - statTotal(a.power) ||
          a.cardVariantId.localeCompare(b.cardVariantId)
      )
      .slice(0, 3);
    return top.length ? top[Math.floor(rand() * top.length)].cardVariantId : null;
  };
  const spent = (v: DraftBotView) => {
    const byId = new Map(v.pool.map((c) => [c.cardVariantId, c]));
    return v.myPicks.reduce((s, id) => s + (byId.get(id)?.cost ?? 0), 0);
  };
  const affordable = (v: DraftBotView) =>
    v.pool.filter(
      (c) =>
        !v.unavailable.has(c.cardVariantId) &&
        c.cost <= v.budgetTotal - spent(v)
    );
  return {
    name: "noisy-auto",
    ban: (v) => topThree(affordable(v)),
    pick: (v) => topThree(affordable(v)),
    block: (v) =>
      topThree(v.pool.filter((c) => v.opponentPicks.includes(c.cardVariantId))),
  };
}

/** Uniformly random legal choices: a floor for "does drafting matter at all". */
export function randomDrafter(rand: () => number): SimDrafter {
  const any = <T>(xs: T[]) => (xs.length ? xs[Math.floor(rand() * xs.length)] : null);
  const spent = (v: DraftBotView) => {
    const byId = new Map(v.pool.map((c) => [c.cardVariantId, c]));
    return v.myPicks.reduce((s, id) => s + (byId.get(id)?.cost ?? 0), 0);
  };
  return {
    name: "random",
    ban: (v) =>
      any(v.pool.filter((c) => !v.unavailable.has(c.cardVariantId)))
        ?.cardVariantId ?? null,
    pick: (v) =>
      any(
        v.pool.filter(
          (c) =>
            !v.unavailable.has(c.cardVariantId) &&
            c.cost <= v.budgetTotal - spent(v)
        )
      )?.cardVariantId ?? null,
    block: (v) => any(v.opponentPicks),
  };
}

/** Same cadence as rankedDraft.service pickerForIndex. */
function pickerSeat(pickIndex: number): 1 | 2 {
  if (pickIndex === 0) return 1;
  const block = Math.floor((pickIndex - 1) / RANKED_DRAFT_CONFIG.PICKS_PER_TURN);
  return block % 2 === 0 ? 2 : 1;
}

export interface SimDraftResult {
  /** Post-block decks (PICKS - BLOCKS cards each). */
  p1Kept: string[];
  p2Kept: string[];
  p1Picks: string[];
  p2Picks: string[];
  bans: [string | null, string | null];
}

export function simulateDraft(
  pool: DraftPoolCard[],
  p1: SimDrafter,
  p2: SimDrafter
): SimDraftResult {
  const picks: Record<1 | 2, string[]> = { 1: [], 2: [] };
  const bans: [string | null, string | null] = [null, null];
  const max = RANKED_DRAFT_CONFIG.PICKS;

  const view = (seat: 1 | 2, includeBans: boolean): DraftBotView => {
    const unavailable = new Set([...picks[1], ...picks[2]]);
    if (includeBans) for (const b of bans) if (b) unavailable.add(b);
    return {
      pool,
      unavailable,
      myPicks: [...picks[seat]],
      opponentPicks: [...picks[seat === 1 ? 2 : 1]],
      budgetTotal: RANKED_DRAFT_CONFIG.POWER_BUDGET,
      picksTotal: max,
    };
  };

  // Bans are simultaneous: neither sees the other's.
  bans[0] = p1.ban(view(1, false));
  bans[1] = p2.ban(view(2, false));

  const drafter = { 1: p1, 2: p2 } as const;
  while (picks[1].length < max || picks[2].length < max) {
    let seat = pickerSeat(picks[1].length + picks[2].length);
    if (picks[seat].length >= max) seat = seat === 1 ? 2 : 1;
    const choice = drafter[seat].pick(view(seat, true));
    if (!choice) throw new Error(`${drafter[seat].name} found no legal pick`);
    const v = view(seat, true);
    if (v.unavailable.has(choice)) {
      throw new Error(`${drafter[seat].name} picked an unavailable card`);
    }
    const byId = new Map(pool.map((c) => [c.cardVariantId, c]));
    const spent = [...picks[seat], choice].reduce(
      (sum, id) => sum + (byId.get(id)?.cost ?? 0),
      0
    );
    if (spent > RANKED_DRAFT_CONFIG.POWER_BUDGET) {
      throw new Error(`${drafter[seat].name} went over budget`);
    }
    picks[seat].push(choice);
  }

  const block1 = p1.block(view(1, true)); // removed from p2's deck
  const block2 = p2.block(view(2, true)); // removed from p1's deck
  const without = (xs: string[], id: string | null) => {
    const at = id ? xs.indexOf(id) : -1;
    return at === -1 ? xs : [...xs.slice(0, at), ...xs.slice(at + 1)];
  };
  return {
    p1Picks: picks[1],
    p2Picks: picks[2],
    p1Kept: without(picks[1], block2),
    p2Kept: without(picks[2], block1),
    bans,
  };
}

export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let next = Math.imul(t ^ (t >>> 15), 1 | t);
    next ^= next + Math.imul(next ^ (next >>> 7), 61 | next);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}
