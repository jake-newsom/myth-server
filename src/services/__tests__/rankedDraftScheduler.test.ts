import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Guards the dev/prod entrypoint split.
 *
 * The Ranked Draft tick used to live inline in app.ts inside
 * `require.main === module`. Production starts with `node server.js`, which
 * only *imports* dist/app, so that block never ran there: matchmaking never
 * widened its rating window, expired drafts were never swept after a redeploy,
 * and stale ranked games were never reaped (locking players out of the mode).
 *
 * These are static assertions on purpose — the failure mode is "this code is
 * never reached in production", which no unit test of the scheduler itself can
 * catch.
 */

const repoRoot = path.resolve(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

test("ranked draft scheduler", async (t) => {
  await t.test("the production entrypoint starts the scheduler", () => {
    const serverJs = read("server.js");
    assert.match(
      serverJs,
      /startRankedDraftScheduler\(\)/,
      "server.js (the `npm start` entrypoint) must start the ranked draft scheduler; " +
        "app.ts's require.main block does NOT run when app is merely imported."
    );
  });

  await t.test("the production entrypoint stops it on shutdown", () => {
    const serverJs = read("server.js");
    assert.match(serverJs, /stopRankedDraftScheduler\(\)/);
  });

  await t.test("the dev entrypoint starts the same shared scheduler", () => {
    const appTs = read("src/app.ts");
    assert.match(appTs, /startRankedDraftScheduler\(\)/);
    // The tick must not be re-implemented inline: one definition, two callers.
    assert.doesNotMatch(
      appTs,
      /RankedMatchmakingService\.runMatchPass\(\)/,
      "app.ts should delegate to rankedDraftScheduler.service rather than " +
        "inlining the tick, so both entrypoints run identical logic."
    );
  });

  await t.test("starting twice does not double-schedule", () => {
    // Asserted statically: importing the module pulls in the DB/JWT service
    // graph, which a unit test has no business booting. Idempotence is the
    // contract both entrypoints rely on — app.ts and server.js may each call
    // start() in a process that runs both.
    const scheduler = read("src/services/rankedDraftScheduler.service.ts");
    assert.match(
      scheduler,
      /if \(tickInterval\) return;/,
      "startRankedDraftScheduler must no-op when already running."
    );
  });

  await t.test("the tick cannot overlap itself", () => {
    const scheduler = read("src/services/rankedDraftScheduler.service.ts");
    // sweepExpiredSessions walks sessions serially; a sweep that outruns the
    // interval would otherwise re-enter and race itself inside completeDraft.
    assert.match(scheduler, /if \(ticking\)/);
    assert.match(scheduler, /ticking = false;/);
  });

});
