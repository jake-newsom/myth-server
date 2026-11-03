import test from "node:test";
import assert from "node:assert/strict";
import { pvpLaddersForStart } from "../seasonRewardPayout.service";

// Seasons end on a quarter boundary, so the payout runs in the NEXT quarter.
// The ladder paid must come from the season's own window, not "now".
test("Season 3 (Oct 8 2026) pays the 2026-Q4 ladder and seeds 2027-Q1", () => {
  assert.deepEqual(pvpLaddersForStart(new Date("2026-10-08T00:00:00Z")), {
    finished: "draft-2026-Q4",
    next: "draft-2027-Q1",
  });
});

test("Season 4 (Jan 8 2027) pays 2027-Q1 and seeds 2027-Q2", () => {
  assert.deepEqual(pvpLaddersForStart(new Date("2027-01-08T00:00:00Z")), {
    finished: "draft-2027-Q1",
    next: "draft-2027-Q2",
  });
});

test("finished and next ladders are never the same key", () => {
  for (let m = 0; m < 12; m++) {
    const r = pvpLaddersForStart(new Date(Date.UTC(2026, m, 8)));
    assert.notEqual(r.finished, r.next);
  }
});
