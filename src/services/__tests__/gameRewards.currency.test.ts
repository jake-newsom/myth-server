import { test, describe } from "node:test";
import assert from "node:assert";

import GameRewardsService from "../gameRewards.service";

/**
 * Gem payout rules.
 *
 * `calculateCurrencyRewards` is pure — it touches no database — so these run
 * without any fixture. The ember gate itself lives in `processGameCompletion`
 * (which short-circuits to `{ gems: 0 }` when the game did not pay its ember);
 * what is pinned here is the payout table that gate wraps, plus the fact that
 * the win streak no longer moves any of it.
 *
 * Run with `npm run test:economy`, which carries two flags this file needs:
 *
 *   -r dotenv/config      importing the service transitively constructs
 *                         SessionService, which throws unless JWT_SECRET is set.
 *   TS_NODE_TRANSPILE_ONLY ts-node type-checks the whole import graph, and
 *                         game.controller.ts has pre-existing errors on main
 *                         (User is missing user_id/role) unrelated to this file.
 *                         `npm run build` is what type-checks the project.
 */

const USER = "user-1";
const OTHER = "user-2";

/** Anything under 180s earns the quick-victory bonus. */
const QUICK = 120;
const SLOW = 300;

describe("calculateCurrencyRewards — gem payouts", () => {
  describe("solo", () => {
    test("win pays 5, plus 2 for a quick victory", () => {
      assert.strictEqual(
        GameRewardsService.calculateCurrencyRewards(USER, USER, "solo", SLOW)
          .gems,
        5
      );
      assert.strictEqual(
        GameRewardsService.calculateCurrencyRewards(USER, USER, "solo", QUICK)
          .gems,
        7
      );
    });

    test("draw pays 2, loss pays 1, forfeit pays nothing", () => {
      assert.strictEqual(
        GameRewardsService.calculateCurrencyRewards(USER, null, "solo", SLOW)
          .gems,
        2
      );
      assert.strictEqual(
        GameRewardsService.calculateCurrencyRewards(USER, OTHER, "solo", SLOW)
          .gems,
        1
      );
      assert.strictEqual(
        GameRewardsService.calculateCurrencyRewards(
          USER,
          OTHER,
          "solo",
          SLOW,
          1.0,
          true // isForfeit
        ).gems,
        0
      );
    });
  });

  describe("pvp", () => {
    test("win pays 10, plus 3 for a quick victory", () => {
      assert.strictEqual(
        GameRewardsService.calculateCurrencyRewards(USER, USER, "pvp", SLOW)
          .gems,
        10
      );
      assert.strictEqual(
        GameRewardsService.calculateCurrencyRewards(USER, USER, "pvp", QUICK)
          .gems,
        13
      );
    });

    test("draw pays 3, loss pays 5, forfeit pays nothing", () => {
      assert.strictEqual(
        GameRewardsService.calculateCurrencyRewards(USER, null, "pvp", SLOW)
          .gems,
        3
      );
      assert.strictEqual(
        GameRewardsService.calculateCurrencyRewards(USER, OTHER, "pvp", SLOW)
          .gems,
        5
      );
      assert.strictEqual(
        GameRewardsService.calculateCurrencyRewards(
          USER,
          OTHER,
          "pvp",
          SLOW,
          1.0,
          true // isForfeit
        ).gems,
        0
      );
    });
  });

  /**
   * The regression this rebalance exists to prevent.
   *
   * A max-streak quick PvP win used to pay floor(13 * 5.0) = 65 gems on the one
   * mode embers do not gate. If any of these start varying with the multiplier
   * again, the uncapped faucet is back.
   */
  describe("win streak multiplier is ignored", () => {
    for (const multiplier of [1.0, 2.5, 5.0]) {
      test(`pays the same at ${multiplier}x`, () => {
        assert.strictEqual(
          GameRewardsService.calculateCurrencyRewards(
            USER,
            USER,
            "pvp",
            QUICK,
            multiplier
          ).gems,
          13,
          "quick pvp win must stay flat"
        );
        assert.strictEqual(
          GameRewardsService.calculateCurrencyRewards(
            USER,
            null,
            "pvp",
            SLOW,
            multiplier
          ).gems,
          3,
          "pvp draw must stay flat"
        );
        assert.strictEqual(
          GameRewardsService.calculateCurrencyRewards(
            USER,
            USER,
            "solo",
            QUICK,
            multiplier
          ).gems,
          7,
          "solo was never multiplied"
        );
      });
    }
  });
});
