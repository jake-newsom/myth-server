import test from "node:test";
import assert from "node:assert/strict";
import {
  DraftBotView,
  DraftPoolCard,
  DraftValueTable,
  bestFill,
  cardValue,
  chooseBotBan,
  chooseBotBlock,
  chooseBotPick,
  naivePick,
  strengthForRating,
  MIN_STRENGTH,
  USAGE_WEIGHT,
  scorePicks,
} from "../draft/draftBot";
import {
  autoDrafter,
  botDrafter,
  mulberry32,
  randomDrafter,
  simulateDraft,
} from "../sim/sim.draft";
import { RANKED_DRAFT_CONFIG, RARITY_POWER_COST } from "../../config/constants";

const card = (
  id: string,
  rarity: keyof typeof RARITY_POWER_COST,
  stat = 5
): DraftPoolCard => ({
  cardVariantId: id,
  name: id,
  rarity,
  cost: RARITY_POWER_COST[rarity],
  power: { top: stat, right: stat, bottom: stat, left: stat },
});

const table = (values: Record<string, number>): DraftValueTable => ({
  version: 1,
  values,
  fallback: { intercept: 0, perStat: 0, perMinSide: 0 },
});

const view = (pool: DraftPoolCard[], over: Partial<DraftBotView> = {}): DraftBotView => ({
  pool,
  unavailable: new Set(),
  myPicks: [],
  opponentPicks: [],
  budgetTotal: RANKED_DRAFT_CONFIG.POWER_BUDGET,
  picksTotal: RANKED_DRAFT_CONFIG.PICKS,
  ...over,
});

/** A pool shaped like the real one: plenty of every rarity. */
function realisticPool(): DraftPoolCard[] {
  const pool: DraftPoolCard[] = [];
  const rarities: [keyof typeof RARITY_POWER_COST, number, number][] = [
    ["legendary", 19, 7],
    ["epic", 27, 6],
    ["rare", 13, 5],
    ["common", 31, 4],
  ];
  for (const [rarity, n, base] of rarities) {
    for (let i = 0; i < n; i++) {
      pool.push(card(`${rarity}-${String(i).padStart(2, "0")}`, rarity, base + (i % 3)));
    }
  }
  return pool;
}

test("draft bot", async (t) => {
  await t.test("bestFill solves the cardinality-constrained knapsack", () => {
    const cards = [
      { cost: 9, value: 5 },
      { cost: 9, value: 4 },
      { cost: 3, value: 3 },
      { cost: 0, value: 1 },
      { cost: 0, value: 0.5 },
    ];
    assert.equal(bestFill(cards, 12, 2), 8); // 9+3 -> 5+3
    assert.equal(bestFill(cards, 18, 2), 9); // both legendaries
    assert.equal(bestFill(cards, 0, 2), 1.5); // only the free cards
    assert.equal(bestFill(cards, 0, 3), -Infinity); // can't fill 3 for free
    assert.equal(bestFill(cards, 50, 0), 0);
  });

  await t.test("learned values win; unknown cards use the fallback", () => {
    const tbl: DraftValueTable = {
      version: 1,
      values: { known: 0.7 },
      fallback: { intercept: -1, perStat: 0.1, perMinSide: 0 },
    };
    assert.equal(cardValue(card("known", "epic"), tbl), 0.7);
    // 4 sides × 5 = 20 → -1 + 2.0
    assert.equal(cardValue(card("new-card", "epic", 5), tbl), 1);
  });

  await t.test("strength is gentle for new players and full at 1400+", () => {
    assert.equal(strengthForRating(900), MIN_STRENGTH);
    assert.equal(strengthForRating(1000), MIN_STRENGTH);
    const mid = strengthForRating(1200);
    assert.ok(mid > MIN_STRENGTH && mid < 1);
    assert.equal(strengthForRating(1400), 1);
    assert.equal(strengthForRating(2000), 1);
  });

  await t.test("strength 0 drafts exactly like the timeout auto-pick", () => {
    const pool = realisticPool();
    const v = view(pool);
    const pick = chooseBotPick(v, { table: null, strength: 0, looseness: 0, rand: () => 0.5 });
    assert.equal(pick, naivePick(v));
  });

  await t.test("never picks an unaffordable or unavailable card", () => {
    const pool = [card("L1", "legendary"), card("L2", "legendary"), card("C1", "common"), card("C2", "common")];
    const tbl = table({ l1: 9, l2: 8, c1: 0, c2: 0 });
    // 45 spent of 50: no legendary fits.
    const v = view(pool, {
      myPicks: ["x1", "x2", "x3", "x4", "x5"],
      unavailable: new Set(["C1"]),
      pool: [
        ...pool,
        ...["x1", "x2", "x3", "x4", "x5"].map((id) => card(id, "legendary")),
      ],
    });
    const pick = chooseBotPick(v, { table: tbl, strength: 1, looseness: 0, rand: () => 0 });
    assert.equal(pick, "C2");
  });

  await t.test("paces the budget instead of grabbing the single best card", () => {
    // Two picks left with 11 budget. The legendary (value 5, cost 9) leaves 2,
    // so the last slot is a 0-value common: 5 + 0 = 5. An epic (3) leaves 8,
    // enough for the other epic: 3 + 3 = 6. Pacing must take the epic.
    const pool = [
      card("Leg", "legendary"),
      card("EpA", "epic"),
      card("EpB", "epic"),
      card("Com", "common"),
    ];
    const tbl = table({ leg: 5, epa: 3, epb: 3, com: 0 });
    const held = [
      ...Array.from({ length: 5 }, (_, i) => card(`free${i}`, "common")),
      ...Array.from({ length: 4 }, (_, i) => card(`spent${i}`, "legendary")),
    ];
    const v = view([...pool, ...held], {
      myPicks: held.map((c) => c.cardVariantId), // 9 held, 36 spent
      unavailable: new Set(held.map((c) => c.cardVariantId)),
      budgetTotal: 47, // 11 left
      // Opponent is full: nothing will be taken from under us.
      opponentPicks: Array.from({ length: 11 }, (_, i) => `opp${i}`),
    });
    const scored = scorePicks(v, tbl);
    assert.ok(scored[0].cardVariantId.startsWith("Ep"), `took ${scored[0].cardVariantId}`);
    assert.equal(scored[0].score, 6);
    assert.equal(scored.find((c) => c.cardVariantId === "Leg")!.score, 5);
  });

  await t.test("takes a contested card now rather than planning around it", () => {
    // Opponent has budget and picks left: the top card will be gone, so the
    // bot should take it while it can.
    const pool = [card("Top", "epic"), card("Mid", "epic"), card("Low", "epic")];
    const tbl = table({ top: 5, mid: 1, low: 0.5 });
    const scored = scorePicks(view(pool, { picksTotal: 2 }), tbl);
    assert.equal(scored[0].cardVariantId, "Top");
  });

  await t.test("bans the strongest card and blocks the opponent's best", () => {
    const pool = [card("A", "epic"), card("B", "legendary"), card("C", "rare")];
    const tbl = table({ a: 1, b: 3, c: 2 });
    assert.equal(chooseBotBan(view(pool), { table: tbl }), "B");
    assert.equal(
      chooseBotBlock(view(pool, { opponentPicks: ["A", "C"] }), { table: tbl }),
      "C"
    );
  });

  await t.test("a loose bot still only ever takes a top candidate", () => {
    const pool = realisticPool();
    const v = view(pool);
    const top5 = new Set(scorePicks(v, null).slice(0, 5).map((s) => s.cardVariantId));
    const rand = mulberry32(3);
    for (let i = 0; i < 50; i++) {
      const pick = chooseBotPick(v, { table: null, strength: 1, looseness: 1.5, rand });
      assert.ok(top5.has(pick!));
    }
  });

  await t.test("full simulated drafts are legal from either seat", () => {
    const pool = realisticPool();
    const rand = mulberry32(11);
    const cost = (ids: string[]) =>
      ids.reduce((s, id) => s + pool.find((c) => c.cardVariantId === id)!.cost, 0);
    for (const [a, b] of [
      [botDrafter(null, 1, 0, rand), autoDrafter()],
      [autoDrafter(), botDrafter(null, 0.25, 1.5, rand)],
      [randomDrafter(rand), botDrafter(null, 0.6, 0.5, rand)],
    ] as const) {
      const r = simulateDraft(pool, a, b);
      assert.equal(r.p1Picks.length, RANKED_DRAFT_CONFIG.PICKS);
      assert.equal(r.p2Picks.length, RANKED_DRAFT_CONFIG.PICKS);
      assert.equal(r.p1Kept.length, RANKED_DRAFT_CONFIG.PICKS - 1);
      assert.equal(r.p2Kept.length, RANKED_DRAFT_CONFIG.PICKS - 1);
      assert.ok(cost(r.p1Picks) <= RANKED_DRAFT_CONFIG.POWER_BUDGET);
      assert.ok(cost(r.p2Picks) <= RANKED_DRAFT_CONFIG.POWER_BUDGET);
      const all = [...r.p1Picks, ...r.p2Picks];
      assert.equal(new Set(all).size, all.length, "no card drafted twice");
      for (const ban of r.bans) assert.ok(ban && !all.includes(ban), "bans stay out");
    }
  });

  await t.test("scoring a full pick is fast enough for a live turn", () => {
    const pool = realisticPool();
    const started = Date.now();
    scorePicks(view(pool), null);
    assert.ok(Date.now() - started < 500, `took ${Date.now() - started}ms`);
  });

  await t.test("ban and block lean toward popular cards, not weak ones", () => {
    const pool = [card("strong", "epic"), card("popular", "epic"), card("weak", "epic")];
    const values = table({ strong: 0.5, popular: 0.4, weak: -0.2 });
    const usage = new Map([["popular", 1], ["weak", 1], ["strong", 0.2]]);
    const opts = { table: values, strength: 1, rand: () => 0 };

    // No usage data: unchanged, value only.
    assert.equal(chooseBotBan(view(pool), opts), "strong");
    // A popular card beats a slightly stronger unpopular one...
    assert.equal(chooseBotBan(view(pool, { usage }), opts), "popular");
    const theirs = { opponentPicks: ["strong", "popular", "weak"] };
    assert.equal(chooseBotBlock(view(pool, { ...theirs, usage }), opts), "popular");
    // ...but popularity alone never outweighs a big value gap.
    assert.ok(0.5 + USAGE_WEIGHT * 0.2 > -0.2 + USAGE_WEIGHT);
    const noPopular = new Map([["weak", 1], ["strong", 0]]);
    assert.equal(chooseBotBan(view(pool, { usage: noPopular }), opts), "strong");
  });
});
