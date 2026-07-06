import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getCurrentInstancePeriodEnd,
  getInstancePeriodStart,
  isRunInCurrentInstancePeriod,
} from "../sagaInstancePeriod.service";

describe("sagaInstancePeriod", () => {
  // 2026-07-06 is a Monday
  const monday = new Date("2026-07-06T00:00:00.000Z");
  // 2026-07-12 is a Sunday (last day of the same week)
  const sunday = new Date("2026-07-12T23:59:59.999Z");
  // 2026-07-13 is the next Monday
  const nextMonday = new Date("2026-07-13T00:00:00.000Z");

  it("returns Monday 00:00 UTC as the period start for a mid-week time", () => {
    const wednesday = new Date("2026-07-08T14:30:00.000Z");
    assert.equal(
      getInstancePeriodStart(wednesday).toISOString(),
      "2026-07-06T00:00:00.000Z"
    );
  });

  it("returns the same Monday when called exactly on Monday 00:00 UTC", () => {
    assert.equal(
      getInstancePeriodStart(monday).toISOString(),
      "2026-07-06T00:00:00.000Z"
    );
  });

  it("returns the next Monday as the period end", () => {
    assert.equal(
      getCurrentInstancePeriodEnd(monday).toISOString(),
      "2026-07-13T00:00:00.000Z"
    );
  });

  it("treats a run created before the current Monday as expired", () => {
    // run from previous week, checked on Wednesday of new week
    const oldRun = new Date("2026-07-05T23:59:59.000Z"); // Sunday before
    const now = new Date("2026-07-08T10:00:00.000Z");    // Wednesday
    assert.equal(isRunInCurrentInstancePeriod(oldRun, now), false);
  });

  it("treats a run created after the current Monday as active", () => {
    const freshRun = new Date("2026-07-06T00:00:01.000Z");
    const now = new Date("2026-07-08T10:00:00.000Z");
    assert.equal(isRunInCurrentInstancePeriod(freshRun, now), true);
  });

  it("treats a run created exactly on Monday 00:00 UTC as active", () => {
    assert.equal(isRunInCurrentInstancePeriod(monday, monday), true);
  });

  it("treats a run from Sunday night as expired once next Monday arrives", () => {
    assert.equal(isRunInCurrentInstancePeriod(sunday, nextMonday), false);
  });
});
