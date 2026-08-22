import { test, describe } from "node:test";
import assert from "node:assert";
import {
  blocksComplete,
  validateBlock,
  DraftRuleError,
} from "../rankedDraft.service";
import {
  RANKED_DRAFT_CONFIG,
  RANKED_DRAFT_CARDS_AFTER_BLOCK,
  RANKED_DRAFT_DECK_SIZE,
} from "../../config/constants";
import { DECK_CONFIG } from "../../config/constants";
import { RankedDraftSession } from "../../models/rankedDraftSession.model";

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
    player1_block: null,
    player2_block: null,
    current_picker_id: null,
    pick_index: 0,
    deadline_at: null,
    game_id: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...over,
  } as RankedDraftSession;
}

describe("ranked draft: block phase", () => {
  test("11 drafted minus 1 blocked still builds a legal deck", () => {
    assert.equal(RANKED_DRAFT_CONFIG.PICKS, 11);
    assert.equal(RANKED_DRAFT_CARDS_AFTER_BLOCK, 10);
    assert.equal(RANKED_DRAFT_DECK_SIZE, DECK_CONFIG.DECK_SIZE);
  });

  test("draftBattle's pick guard matches what completeDraft passes it", () => {
    // completeDraft removes the blocked card BEFORE calling buildDraftGameState,
    // so the guard there must check the post-block count. Checking PICKS instead
    // rejected every legal draft with
    // "[draftBattle] player1 has 10 picks, expected 11".
    const passedToBuild = RANKED_DRAFT_CONFIG.PICKS - RANKED_DRAFT_CONFIG.BLOCKS_PER_PLAYER;
    assert.equal(passedToBuild, RANKED_DRAFT_CARDS_AFTER_BLOCK);
    assert.equal(
      RANKED_DRAFT_CARDS_AFTER_BLOCK * RANKED_DRAFT_CONFIG.COPIES_PER_PICK,
      DECK_CONFIG.DECK_SIZE
    );
  });

  test("blocksComplete only when BOTH are in", () => {
    assert.ok(!blocksComplete(session()));
    assert.ok(!blocksComplete(session({ player1_block: B })));
    assert.ok(!blocksComplete(session({ player2_block: A })));
    assert.ok(blocksComplete(session({ player1_block: B, player2_block: A })));
  });

  test("you may only block a card the OPPONENT drafted", async () => {
    // P1 blocking P2's card is fine.
    await validateBlock(session(), P1, B);
    // P1 blocking their OWN card is not.
    await assert.rejects(
      () => validateBlock(session(), P1, A),
      DraftRuleError
    );
    // Nor a card nobody drafted.
    await assert.rejects(
      () => validateBlock(session(), P1, "cccccccc-3333-3333-3333-333333333333"),
      DraftRuleError
    );
  });

  test("a block cannot be changed once made", async () => {
    await assert.rejects(
      () => validateBlock(session({ player1_block: B }), P1, B),
      DraftRuleError
    );
  });

  test("blocks are rejected outside the block phase", async () => {
    await assert.rejects(
      () => validateBlock(session({ phase: "draft" }), P1, B),
      DraftRuleError
    );
  });

  test("removing the blocked card leaves the opponent's other picks intact", () => {
    // Mirrors completeDraft's applyBlock: player1_block is removed from P2.
    const applyBlock = (picks: string[], blocked: string | null) => {
      if (!blocked) return picks;
      const at = picks.indexOf(blocked);
      return at === -1 ? picks : [...picks.slice(0, at), ...picks.slice(at + 1)];
    };
    const p2Picks = [B, A, "x", "y"];
    assert.deepEqual(applyBlock(p2Picks, B), [A, "x", "y"]);
    assert.deepEqual(applyBlock(p2Picks, "nope"), p2Picks);
    assert.deepEqual(applyBlock(p2Picks, null), p2Picks);
  });
});
