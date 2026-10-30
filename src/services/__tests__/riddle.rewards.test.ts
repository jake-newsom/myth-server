import { test, describe } from "node:test";
import assert from "node:assert";
import { grantClearRewards } from "../riddle.service";
import RewardService from "../reward.service";
import { QueryExecutor } from "../../config/db.config";
import { RewardItem } from "../../types/service.types";

async function run(totalClears: number, attemptsToClear: number) {
  const fakeClient: QueryExecutor = {
    query: (async (sql: string) =>
      sql.includes("avatar_frames")
        ? { rows: [{ frame_id: "frame-1", name: "Eye of the Oracle" }], rowCount: 1 }
        : { rows: [{ n: totalClears }], rowCount: 1 }) as any,
  };
  let items: RewardItem[] = [];
  let executor: QueryExecutor | undefined;
  const original = RewardService.grantRewards;
  RewardService.grantRewards = (async (_u: string, i: RewardItem[], o: { client?: QueryExecutor }) => {
    items = i;
    executor = o.client;
    return { success: true };
  }) as any;
  try {
    const result = await grantClearRewards("u1", attemptsToClear, fakeClient);
    assert.strictEqual(executor, fakeClient, "grant must join the clear's transaction");
    return { result, items };
  } finally {
    RewardService.grantRewards = original;
  }
}

describe("Weekly Riddle clear rewards", () => {
  test("plain clear pays 3 packs + 50 gems", async () => {
    const { result } = await run(1, 2);
    assert.deepStrictEqual([result.packs, result.gems, result.frame], [3, 50, null]);
    assert.strictEqual(result.nextMilestone, 4);
  });

  test("first try adds 50 gems", async () => {
    const { result } = await run(1, 1);
    assert.deepStrictEqual([result.packs, result.gems], [3, 100]);
  });

  for (const [clears, packs, gems] of [[4, 8, 50], [12, 13, 250], [52, 33, 1050]]) {
    test(`${clears} clears stacks its milestone on the clear reward`, async () => {
      const { result } = await run(clears, 2);
      assert.deepStrictEqual([result.packs, result.gems, result.milestoneReached], [packs, gems, clears]);
    });
  }

  test("26 clears grants the frame", async () => {
    const { result, items } = await run(26, 2);
    assert.strictEqual(result.frame, "Eye of the Oracle");
    assert.ok(items.some((i) => i.type === "avatar_frame" && i.frame_id === "frame-1"));
    assert.strictEqual(result.nextMilestone, 52);
  });

  test("between and past milestones pays only the clear reward", async () => {
    const between = await run(5, 2);
    assert.strictEqual(between.result.milestoneReached, null);
    const past = await run(53, 2);
    assert.deepStrictEqual([past.result.packs, past.result.nextMilestone], [3, null]);
  });
});
