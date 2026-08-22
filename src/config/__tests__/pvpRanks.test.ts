import { test, describe } from "node:test";
import assert from "node:assert";
import {
  PVP_RANKS,
  IMMORTAL_FLOOR,
  POSITIONAL_DECAY_DAYS,
  hasDecayed,
  earnedRankForRating,
  positionalBracket,
  resolveRank,
  divisionForRating,
} from "../pvpRanks";

const fresh = () => new Date();
const stale = () => new Date(Date.now() - 20 * 86_400_000);

describe("pvp ranks: earned bands", () => {
  test("bands are contiguous with no gaps or overlaps", () => {
    const earned = PVP_RANKS.filter((r) => r.kind === "earned").sort(
      (a, b) => a.order - b.order
    );
    assert.strictEqual(earned[0].minRating, 0, "ladder must start at 0");
    for (let i = 1; i < earned.length; i++) {
      assert.strictEqual(
        earned[i].minRating,
        earned[i - 1].maxRating + 1,
        `${earned[i - 1].key} -> ${earned[i].key} must be contiguous`
      );
    }
    assert.strictEqual(
      earned[earned.length - 1].maxRating,
      Infinity,
      "top band must be unbounded"
    );
  });

  test("retired ranks are gone", () => {
    const keys = PVP_RANKS.map((r) => r.key);
    assert.ok(!keys.includes("mortal"));
    assert.ok(!keys.includes("demigod"));
  });

  test("every rating maps to exactly one earned rank", () => {
    for (const rating of [0, 1, 999, 1049, 1050, 1149, 1150, 1424, 1425, 9999]) {
      const rank = earnedRankForRating(rating);
      assert.strictEqual(rank.kind, "earned");
      assert.ok(rating >= rank.minRating && rating <= rank.maxRating);
    }
  });

  test("Immortal begins exactly at the floor", () => {
    assert.strictEqual(earnedRankForRating(IMMORTAL_FLOOR).key, "immortal");
    assert.strictEqual(earnedRankForRating(IMMORTAL_FLOOR - 1).key, "ascendant");
  });

  test("a negative rating clamps to the lowest rank rather than throwing", () => {
    assert.strictEqual(earnedRankForRating(-50).key, "seeker");
  });

  test("divisions count down as rating rises", () => {
    const champ = PVP_RANKS.find((r) => r.key === "champion")!;
    assert.strictEqual(divisionForRating(champ.minRating, champ), 3);
    assert.strictEqual(divisionForRating(champ.maxRating, champ), 1);
  });
});

describe("pvp ranks: positional brackets", () => {
  const titan = PVP_RANKS.find((r) => r.key === "titan")!;
  const worldforger = PVP_RANKS.find((r) => r.key === "worldforger")!;

  test("Titan is withheld until the pool meets its minimum", () => {
    assert.strictEqual(positionalBracket(titan, 14), 0);
    assert.strictEqual(positionalBracket(titan, 15), 1);
  });

  test("Titan scales with the pool", () => {
    assert.strictEqual(positionalBracket(titan, 100), 10);
    assert.strictEqual(positionalBracket(titan, 1000), 100);
  });

  test("an unknown pool cannot award a proportional rank", () => {
    assert.strictEqual(positionalBracket(titan, null), 0);
    assert.strictEqual(positionalBracket(titan, undefined), 0);
  });

  test("Worldforger's fixed bracket ignores the pool entirely", () => {
    assert.strictEqual(positionalBracket(worldforger, 0), 3);
    assert.strictEqual(positionalBracket(worldforger, 10_000), 3);
  });
});

describe("pvp ranks: resolveRank", () => {
  test("the best player gets the BEST rank, not the narrowest bracket", () => {
    // Regression: sorting positional ranks by bracket size handed Pantheon to
    // #1 and Worldforger to #3, because a 10% slice of 20 is narrower than
    // Worldforger's fixed 3.
    const at = (pos: number) =>
      resolveRank({
        rating: 1500,
        rankPosition: pos,
        lastGameAt: fresh(),
        poolSize: 20,
      }).rank.key;
    assert.strictEqual(at(1), "zenith");
    assert.strictEqual(at(2), "worldforger");
    assert.strictEqual(at(3), "worldforger");
    assert.strictEqual(at(4), "immortal");
  });

  test("with a deep pool the tiers separate", () => {
    const at = (pos: number) =>
      resolveRank({
        rating: 1500,
        rankPosition: pos,
        lastGameAt: fresh(),
        poolSize: 100,
      }).rank.key;
    assert.strictEqual(at(1), "zenith");
    assert.strictEqual(at(3), "worldforger");
    assert.strictEqual(at(4), "titan");
    assert.strictEqual(at(10), "titan");
    assert.strictEqual(at(11), "immortal");
  });

  test("a positional rank requires the rating floor, not just the position", () => {
    const resolved = resolveRank({
      rating: IMMORTAL_FLOOR - 1,
      rankPosition: 1,
      lastGameAt: fresh(),
      poolSize: 100,
    });
    assert.strictEqual(resolved.rank.kind, "earned");
  });

  test("the decay window is 7 days, boundary inclusive", () => {
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
    assert.strictEqual(POSITIONAL_DECAY_DAYS, 7);
    assert.strictEqual(hasDecayed(daysAgo(6)), false);
    // Strictly greater-than, so exactly the window still holds the rank.
    assert.strictEqual(hasDecayed(daysAgo(7)), false);
    assert.strictEqual(hasDecayed(daysAgo(8)), true);
    // Never having played counts as decayed, not as a held rank.
    assert.strictEqual(hasDecayed(null), true);
    assert.strictEqual(hasDecayed(undefined), true);
  });

  test("an idle holder decays back to their earned rank", () => {
    const resolved = resolveRank({
      rating: 1500,
      rankPosition: 1,
      lastGameAt: stale(),
      poolSize: 100,
    });
    assert.strictEqual(resolved.rank.key, "immortal");
  });

  test("Zenith is held by exactly one player", () => {
    const zenith = PVP_RANKS.find((r) => r.key === "zenith")!;
    assert.strictEqual(positionalBracket(zenith, 100), 1);
    assert.strictEqual(positionalBracket(zenith, 15), 1);
  });

  test("every positional rank has a distinct order, best last", () => {
    // resolveRank picks by `order`, so a tie would make the winner arbitrary.
    const positional = PVP_RANKS.filter((r) => r.kind === "positional");
    const orders = positional.map((r) => r.order);
    assert.strictEqual(new Set(orders).size, orders.length);
  });

  test("positional ranks carry no division", () => {
    const resolved = resolveRank({
      rating: 1500,
      rankPosition: 1,
      lastGameAt: fresh(),
      poolSize: 100,
    });
    assert.strictEqual(resolved.division, 0);
    assert.strictEqual(resolved.label, resolved.rank.label);
  });
});
