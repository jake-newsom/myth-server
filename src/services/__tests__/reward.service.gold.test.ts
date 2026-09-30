import { test, describe } from "node:test";
import assert from "node:assert";
import RewardService from "../reward.service";
import UserModel from "../../models/user.model";
import { QueryExecutor } from "../../config/db.config";

/**
 * Regression: granting gold alongside another currency must run every UPDATE
 * on the CALLER'S executor.
 *
 * `executeGrant` used to call `UserModel.updateGold(userId, amount)` without
 * the client, sending it to the pool while the caller's transaction already
 * held a lock on that same `users` row. The pool query then waited for a lock
 * that could only be released by the transaction that was itself blocked
 * waiting on the query — a self-deadlock that hung for the full
 * statement_timeout (15s) on any grant mixing gold with another currency.
 *
 * Asserting on the executor rather than on timing keeps this deterministic and
 * DB-free: if gold ever goes back to the pool, `usedPool` flips to true.
 */
describe("RewardService — gold runs on the caller's executor", () => {
  test("updateGold receives the caller's client, not the pool", async () => {
    const seen: string[] = [];
    let goldExecutor: QueryExecutor | undefined;

    const fakeClient: QueryExecutor = {
      query: async () => ({ rows: [{}], rowCount: 1 } as any),
    };

    const original = UserModel.updateGold;
    const originalGems = UserModel.updateGems;
    const originalFind = UserModel.findById;

    UserModel.updateGold = (async (_u: string, _a: number, client?: QueryExecutor) => {
      seen.push("gold");
      goldExecutor = client;
      return null;
    }) as typeof UserModel.updateGold;

    UserModel.updateGems = (async () => {
      seen.push("gems");
      return null;
    }) as typeof UserModel.updateGems;

    UserModel.findById = (async () => null) as typeof UserModel.findById;

    try {
      await RewardService.grantRewards(
        "user-1",
        [
          { type: "gems", amount: 10 },
          { type: "gold", amount: 25 },
        ],
        { client: fakeClient }
      );

      assert.ok(seen.includes("gold"), "gold should have been granted");
      assert.strictEqual(
        goldExecutor,
        fakeClient,
        "updateGold must receive the caller's client; passing undefined sends it " +
          "to the pool and self-deadlocks against the caller's own row lock"
      );
    } finally {
      UserModel.updateGold = original;
      UserModel.updateGems = originalGems;
      UserModel.findById = originalFind;
    }
  });
});
