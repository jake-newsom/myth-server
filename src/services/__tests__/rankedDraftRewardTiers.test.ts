import { test, describe } from "node:test";
import assert from "node:assert";
import {
  SEASONAL_REWARD_TIERS,
  tierForRankKey,
} from "../rankedDraftRewards.service";
import { PVP_RANKS, resolveRank } from "../../config/pvpRanks";

describe("ranked draft: seasonal reward tiers", () => {
  test("every rank in the ladder has a payout band", () => {
    for (const rank of PVP_RANKS) {
      assert.ok(
        tierForRankKey(rank.key),
        `${rank.key} has no reward tier — that rank would pay nothing`
      );
    }
  });

  test("no tier references a rank that does not exist", () => {
    const keys = new Set(PVP_RANKS.map((r) => r.key));
    for (const tier of SEASONAL_REWARD_TIERS) {
      assert.ok(keys.has(tier.rankKey), `${tier.rankKey} is not a real rank`);
    }
  });

  test("rewards increase monotonically with rank", () => {
    const byOrder = [...SEASONAL_REWARD_TIERS].sort((a, b) => {
      const ra = PVP_RANKS.find((r) => r.key === a.rankKey)!;
      const rb = PVP_RANKS.find((r) => r.key === b.rankKey)!;
      return ra.order - rb.order;
    });
    for (let i = 1; i < byOrder.length; i++) {
      assert.ok(
        byOrder[i].gems > byOrder[i - 1].gems,
        `${byOrder[i].label} must pay more gems than ${byOrder[i - 1].label}`
      );
      assert.ok(
        byOrder[i].packs >= byOrder[i - 1].packs,
        `${byOrder[i].label} must not pay fewer packs than ${byOrder[i - 1].label}`
      );
    }
  });

  test("an unknown rank pays nothing rather than defaulting to a band", () => {
    assert.strictEqual(tierForRankKey("mortal"), null);
    assert.strictEqual(tierForRankKey(""), null);
  });

  test("the top of a large ladder maps to the top bands", () => {
    const fresh = new Date();
    const payoutAt = (pos: number) => {
      const resolved = resolveRank({
        rating: 1500,
        rankPosition: pos,
        lastGameAt: fresh,
        poolSize: 100,
      });
      return tierForRankKey(resolved.rank.key)!;
    };
    assert.strictEqual(payoutAt(1).rankKey, "zenith");
    assert.strictEqual(payoutAt(2).rankKey, "worldforger");
    assert.strictEqual(payoutAt(4).rankKey, "titan");
    assert.strictEqual(payoutAt(11).rankKey, "immortal");
  });

  // The regression this change exists to fix: under position bands, finishing
  // #1 on a tiny ladder paid the top prize regardless of how weak the field
  // was. Rank-keyed payouts price the actual achievement instead.
  test("finishing #1 on a small, low-rated ladder does NOT pay the top band", () => {
    const resolved = resolveRank({
      rating: 1154,
      rankPosition: 1,
      lastGameAt: new Date(),
      poolSize: 0,
    });
    const tier = tierForRankKey(resolved.rank.key)!;
    assert.strictEqual(tier.rankKey, "chosen");
    assert.ok(tier.gems < 6000);
  });
});
