import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * completeDraft must be exactly-once.
 *
 * It is reachable from three places — the post-reveal hold, a rejoin's
 * reconcileSession, and the block deadline — each a check-then-act with awaits
 * in between. Without a phase guard, two racers both INSERT a `games` row and
 * the second `complete()` overwrites `game_id`: one game is orphaned and the
 * two players can be handed different games.
 *
 * `abort()` already had this guard, which is what makes abandon forfeits
 * exactly-once; `complete()` did not.
 */

const repoRoot = path.resolve(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

test("ranked draft completion is exactly-once", async (t) => {
  const model = read("src/models/rankedDraftSession.model.ts");
  const orchestrator = read(
    "src/services/rankedDraftOrchestrator.service.ts"
  );

  await t.test("complete() only fires from a live phase", () => {
    const completeFn = model.slice(
      model.indexOf("async complete("),
      model.indexOf("async abort(")
    );
    assert.match(
      completeFn,
      /phase IN \('ban', 'draft', 'block'\)/,
      "complete() must be phase-guarded so a second caller updates zero rows."
    );
  });

  await t.test("complete() reports the loss rather than a bogus row", () => {
    const completeFn = model.slice(
      model.indexOf("async complete("),
      model.indexOf("async abort(")
    );
    assert.match(
      completeFn,
      /Promise<RankedDraftSession \| null>/,
      "a guarded UPDATE can match nothing, so the return type must allow null."
    );
    assert.match(completeFn, /rows\[0\] \?\? null/);
  });

  await t.test("completeDraft serializes on the session lock", () => {
    const fn = orchestrator.slice(
      orchestrator.indexOf("async function completeDraft(")
    );
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    assert.match(
      body,
      /RankedDraftSessionModel\.lock\(/,
      "completeDraft must take the same advisory lock every other write path " +
        "takes, before inserting the game."
    );
    assert.match(
      body,
      /if \(!completed\)/,
      "completeDraft must roll back when complete() reports it lost the race."
    );
  });
});
