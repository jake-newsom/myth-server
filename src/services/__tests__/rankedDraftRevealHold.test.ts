import { test, describe } from "node:test";
import assert from "node:assert";
import { blocksComplete } from "../rankedDraft.service";
import { RANKED_DRAFT_CONFIG } from "../../config/constants";
import { RankedDraftSession } from "../../models/rankedDraftSession.model";

/**
 * Regression cover for the draft that stranded a player on the block screen.
 *
 * Both blocks land, revealBlocksAndStartGame arms the post-reveal hold, and the
 * row still reads phase='block' for the whole window. A rejoin or a sweep
 * landing in that window used to call completeDraft immediately — creating the
 * game (and pulling one player into it) while the other was still watching the
 * reveal, with no path back once the session left the 'block' phase.
 *
 * The guard is reproduced here rather than imported because the orchestrator
 * opens a DB pool at module load.
 */
function shouldCompleteNow(
  session: RankedDraftSession,
  hasLocalTimer: boolean,
  nowMs: number
): boolean {
  if (session.phase !== "block") return false;
  if (!blocksComplete(session)) return false;
  if (hasLocalTimer) return false;
  const holdEndsAt =
    session.updated_at.getTime() + RANKED_DRAFT_CONFIG.BLOCK_REVEAL_MS;
  return holdEndsAt - nowMs <= 0;
}

const P1 = "11111111-1111-1111-1111-111111111111";
const P2 = "22222222-2222-2222-2222-222222222222";
const A = "aaaaaaaa-1111-1111-1111-111111111111";
const B = "bbbbbbbb-2222-2222-2222-222222222222";

function session(over: Partial<RankedDraftSession> = {}): RankedDraftSession {
  return {
    session_id: "s1",
    player1_id: P1,
    player2_id: P2,
    phase: "block",
    player1_ban: null,
    player2_ban: null,
    player1_picks: [A],
    player2_picks: [B],
    player1_variants: {},
    player2_variants: {},
    player1_block: B,
    player2_block: A,
    current_picker_id: null,
    pick_index: 0,
    deadline_at: null,
    game_id: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...over,
  } as RankedDraftSession;
}

describe("ranked draft: post-reveal hold", () => {
  test("a reconcile during the hold does NOT jump the reveal", () => {
    const now = Date.now();
    const s = session({ updated_at: new Date(now) });
    assert.equal(shouldCompleteNow(s, true, now), false);
  });

  test("the hold is respected even when this process lost its timer", () => {
    const now = Date.now();
    // Mid-hold: another node is counting down, so still hands off on schedule.
    const s = session({ updated_at: new Date(now - 1_000) });
    assert.equal(shouldCompleteNow(s, false, now), false);
  });

  test("once the hold has elapsed a lost timer is repaired", () => {
    const now = Date.now();
    const s = session({
      updated_at: new Date(now - RANKED_DRAFT_CONFIG.BLOCK_REVEAL_MS - 1),
    });
    assert.equal(shouldCompleteNow(s, false, now), true);
  });

  test("a half-finished block phase is never completed early", () => {
    const now = Date.now();
    const s = session({
      player2_block: null,
      updated_at: new Date(now - 60_000),
    });
    assert.equal(shouldCompleteNow(s, false, now), false);
  });

  test("the planning hold is the 10s the format specifies", () => {
    assert.equal(RANKED_DRAFT_CONFIG.BLOCK_REVEAL_MS, 10_000);
  });
});
