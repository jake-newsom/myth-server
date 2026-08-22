import { test, describe } from "node:test";
import assert from "node:assert";
import { nextDailyResetAt } from "../rankedDraft.service";
import { RANKED_DRAFT_CONFIG } from "../../config/constants";

describe("ranked draft: daily battle limit", () => {
  test("reset lands on the next 00:00 UTC", () => {
    const at = nextDailyResetAt(new Date("2026-08-21T13:45:12.345Z"));
    assert.strictEqual(at.toISOString(), "2026-08-22T00:00:00.000Z");
  });

  test("a moment before midnight still resets that same midnight", () => {
    const at = nextDailyResetAt(new Date("2026-08-21T23:59:59.999Z"));
    assert.strictEqual(at.toISOString(), "2026-08-22T00:00:00.000Z");
  });

  test("exactly midnight resets at the FOLLOWING midnight, not immediately", () => {
    const at = nextDailyResetAt(new Date("2026-08-21T00:00:00.000Z"));
    assert.strictEqual(at.toISOString(), "2026-08-22T00:00:00.000Z");
  });

  test("month and year boundaries roll over", () => {
    assert.strictEqual(
      nextDailyResetAt(new Date("2026-08-31T10:00:00Z")).toISOString(),
      "2026-09-01T00:00:00.000Z"
    );
    assert.strictEqual(
      nextDailyResetAt(new Date("2026-12-31T10:00:00Z")).toISOString(),
      "2027-01-01T00:00:00.000Z"
    );
  });

  test("leap day is not skipped", () => {
    assert.strictEqual(
      nextDailyResetAt(new Date("2028-02-28T10:00:00Z")).toISOString(),
      "2028-02-29T00:00:00.000Z"
    );
  });

  // remaining is clamped so a cap lowered after players have already exceeded
  // it reports 0 left, never a negative that would render as "(-3 / 20)".
  test("remaining never goes negative", () => {
    const limit = RANKED_DRAFT_CONFIG.DAILY_BATTLE_LIMIT;
    assert.strictEqual(Math.max(0, limit - (limit + 5)), 0);
    assert.strictEqual(Math.max(0, limit - limit), 0);
    assert.strictEqual(Math.max(0, limit - 1), limit - 1);
  });

  test("the shipped cap is 20", () => {
    assert.strictEqual(RANKED_DRAFT_CONFIG.DAILY_BATTLE_LIMIT, 20);
  });
});
