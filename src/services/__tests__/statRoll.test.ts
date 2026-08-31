import { test, describe } from "node:test";
import assert from "node:assert";
import StatRollService from "../statRoll.service";
import { FORGE_CONFIG } from "../../config/constants";

/**
 * The reforge roller.
 *
 * Pure functions of FORGE_CONFIG, so they run without a database — which
 * matters because these decide a card's combat power, and the two properties
 * worth guarding (the odds, and the floor) are statistical rather than
 * example-based.
 */

const NO_LOCKS = { top: false, right: false, bottom: false, left: false };
const HIGH_BASE = { top: 10, right: 10, bottom: 10, left: 10 };
const EDGES = ["top", "right", "bottom", "left"] as const;

describe("reforge distribution", () => {
  test("offsets follow the configured curve", () => {
    // Enough samples that a correct roller lands inside the tolerance
    // essentially always, while a swapped or dropped weight fails loudly.
    const SAMPLES = 200_000;
    const counts = new Map<number, number>();

    for (let i = 0; i < SAMPLES / 4; i++) {
      const roll = StatRollService.roll(HIGH_BASE, NO_LOCKS);
      for (const edge of EDGES) {
        counts.set(roll[edge], (counts.get(roll[edge]) ?? 0) + 1);
      }
    }

    const totalWeight = FORGE_CONFIG.REFORGE.DISTRIBUTION.reduce(
      (sum, entry) => sum + entry.weight,
      0
    );

    for (const { offset, weight } of FORGE_CONFIG.REFORGE.DISTRIBUTION) {
      const expected = weight / totalWeight;
      const actual = (counts.get(offset) ?? 0) / SAMPLES;
      // Absolute tolerance, so the rare +3 (1%) is held to the same real
      // precision as the common 0 rather than a proportional band that would
      // let it drift by half its own frequency.
      assert.ok(
        Math.abs(actual - expected) < 0.01,
        `offset ${offset}: expected ~${(expected * 100).toFixed(1)}%, got ${(
          actual * 100
        ).toFixed(2)}%`
      );
    }
  });

  test("never rolls outside the configured bounds", () => {
    for (let i = 0; i < 20_000; i++) {
      const roll = StatRollService.roll(HIGH_BASE, NO_LOCKS);
      for (const edge of EDGES) {
        assert.ok(roll[edge] >= FORGE_CONFIG.REFORGE.MIN_OFFSET);
        assert.ok(roll[edge] <= FORGE_CONFIG.REFORGE.MAX_OFFSET);
      }
    }
  });
});

describe("reforge floor", () => {
  test("a low-power edge never rolls below the minimum", () => {
    // A 1-power edge rolling -2 would reach -1 without the floor, and the
    // combat maths is not written for a negative edge.
    const base = { top: 1, right: 1, bottom: 2, left: 1 };

    for (let i = 0; i < 20_000; i++) {
      const roll = StatRollService.roll(base, NO_LOCKS);
      for (const edge of EDGES) {
        assert.ok(
          base[edge] + roll[edge] >= FORGE_CONFIG.REFORGE.MIN_RESULTING_POWER,
          `${edge}: ${base[edge]} + ${roll[edge]} fell below the floor`
        );
      }
    }
  });

  test("applyToBasePower matches the floor the roller enforces", () => {
    const summed = StatRollService.applyToBasePower(
      { top: 1, right: 1, bottom: 1, left: 1 },
      { top: -2, right: -1, bottom: 0, left: 3 }
    );

    // The roller would never produce -2 on a 1-power edge, but a row written
    // before a config change could; the display path has to floor too, or the
    // number shown disagrees with the number played.
    assert.deepEqual(summed, { top: 1, right: 1, bottom: 1, left: 4 });
  });

  test("no roll leaves the catalogue power untouched", () => {
    const base = { top: 5, right: 6, bottom: 7, left: 8 };
    assert.deepEqual(StatRollService.applyToBasePower(base, null), base);
    assert.deepEqual(StatRollService.applyToBasePower(base, undefined), base);
  });
});

describe("reforge locks", () => {
  test("locked edges keep their exact prior offset", () => {
    const current = { top: 3, right: -2, bottom: 1, left: 0 };
    const locks = { top: true, right: true, bottom: false, left: false };

    for (let i = 0; i < 1_000; i++) {
      const roll = StatRollService.roll(HIGH_BASE, locks, current);
      assert.equal(roll.top, current.top);
      assert.equal(roll.right, current.right);
    }
  });

  test("unlocked edges do actually move", () => {
    const current = { top: 0, right: 0, bottom: 0, left: 0 };
    const locks = { top: true, right: true, bottom: false, left: false };

    // Over this many rolls an unlocked edge landing on a non-zero at least
    // once is a certainty; never moving would mean the lock is inverted.
    let moved = false;
    for (let i = 0; i < 500 && !moved; i++) {
      const roll = StatRollService.roll(HIGH_BASE, locks, current);
      if (roll.bottom !== 0 || roll.left !== 0) moved = true;
    }
    assert.ok(moved, "unlocked edges never changed across 500 rolls");
  });
});

describe("reforge pricing", () => {
  test("cost rises with every lock held", () => {
    const costs = [0, 1, 2, 3].map((n) => StatRollService.costForLocks(n));
    for (let i = 1; i < costs.length; i++) {
      assert.ok(
        costs[i] > costs[i - 1],
        `locking ${i} edges must cost more than ${i - 1}`
      );
    }
  });

  test("lock counts outside the table are clamped, not undefined", () => {
    // A malformed request must price as something real rather than charging
    // NaN fragments.
    assert.equal(typeof StatRollService.costForLocks(-1), "number");
    assert.equal(typeof StatRollService.costForLocks(99), "number");
    assert.ok(Number.isFinite(StatRollService.costForLocks(99)));
  });
});
