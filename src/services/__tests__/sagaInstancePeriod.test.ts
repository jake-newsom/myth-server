import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SAGA_INSTANCE_PERIOD_MS,
  getCurrentInstancePeriodEnd,
  getInstancePeriodStart,
  isRunInCurrentInstancePeriod,
} from "../sagaInstancePeriod.service";

describe("sagaInstancePeriod", () => {
  const seasonStart = new Date("2026-01-01T00:00:00.000Z");

  it("aligns period start to season anchor", () => {
    const now = new Date(seasonStart.getTime() + 3 * SAGA_INSTANCE_PERIOD_MS + 1000);
    const start = getInstancePeriodStart(now, seasonStart);
    assert.equal(
      start.toISOString(),
      new Date(seasonStart.getTime() + 3 * SAGA_INSTANCE_PERIOD_MS).toISOString()
    );
  });

  it("treats runs created before the current period as expired", () => {
    const now = new Date(seasonStart.getTime() + SAGA_INSTANCE_PERIOD_MS + 1000);
    const oldRun = new Date(seasonStart.getTime() + SAGA_INSTANCE_PERIOD_MS - 1000);
    assert.equal(isRunInCurrentInstancePeriod(oldRun, seasonStart, now), false);
  });

  it("treats runs created in the current period as active", () => {
    const now = new Date(seasonStart.getTime() + SAGA_INSTANCE_PERIOD_MS + 1000);
    const freshRun = new Date(seasonStart.getTime() + SAGA_INSTANCE_PERIOD_MS + 500);
    assert.equal(isRunInCurrentInstancePeriod(freshRun, seasonStart, now), true);
  });

  it("returns the next period boundary", () => {
    const now = new Date(seasonStart.getTime() + 1000);
    const end = getCurrentInstancePeriodEnd(seasonStart, now);
    assert.equal(
      end.toISOString(),
      new Date(seasonStart.getTime() + SAGA_INSTANCE_PERIOD_MS).toISOString()
    );
  });
});
