import { test, describe } from "node:test";
import assert from "node:assert";

import {
  pickerForIndex,
  resolveCurrentPicker,
  isDraftComplete,
  picksLeftInTurn,
  isLastPickOfTurn,
  baseRarity,
  cardPowerCost,
  unavailableCardIds,
  bansComplete,
  isParticipant,
  TOTAL_PICKS,
  DraftRuleError,
} from "../rankedDraft.service";
import {
  draftInstanceId,
  isDraftInstanceId,
  cardVariantIdFromDraftInstanceId,
  assertDraftCacheComplete,
} from "../../game-engine/draftBattle.hydration";
import { RANKED_DRAFT_CONFIG } from "../../config/constants";
import { RankedDraftSession } from "../../models/rankedDraftSession.model";

const P1 = "11111111-1111-1111-1111-111111111111";
const P2 = "22222222-2222-2222-2222-222222222222";

function session(over: Partial<RankedDraftSession> = {}): RankedDraftSession {
  return {
    session_id: "s1",
    player1_id: P1,
    player2_id: P2,
    phase: "draft",
    player1_ban: null,
    player2_ban: null,
    player1_picks: [],
    player2_picks: [],
    current_picker_id: P1,
    pick_index: 0,
    deadline_at: null,
    game_id: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...over,
  } as RankedDraftSession;
}

describe("ranked draft: turn order", () => {
  test("both players get exactly PICKS picks", () => {
    const order = Array.from({ length: TOTAL_PICKS }, (_, i) =>
      pickerForIndex(i, P1, P2)
    );
    assert.equal(order.filter((p) => p === P1).length, RANKED_DRAFT_CONFIG.PICKS);
    assert.equal(order.filter((p) => p === P2).length, RANKED_DRAFT_CONFIG.PICKS);
  });

  test("player 1 picks first", () => {
    assert.equal(pickerForIndex(0, P1, P2), P1);
  });

  test("turns are 1, then PICKS_PER_TURN blocks, then 1", () => {
    // The order is a snake at the seams: P1 opens with a single pick and P2
    // closes with a single pick, so the first-pick advantage is paid back
    // immediately and both players still land on PICKS.
    const order = Array.from({ length: TOTAL_PICKS }, (_, i) =>
      pickerForIndex(i, P1, P2)
    );
    const runs: number[] = [];
    let run = 1;
    for (let i = 1; i < order.length; i++) {
      if (order[i] === order[i - 1]) run++;
      else {
        runs.push(run);
        run = 1;
      }
    }
    runs.push(run);

    assert.equal(runs[0], 1, "P1 opens with a single pick");
    assert.equal(runs[runs.length - 1], 1, "P2 closes with a single pick");
    for (const r of runs.slice(1, -1)) {
      assert.equal(r, RANKED_DRAFT_CONFIG.PICKS_PER_TURN);
    }
    assert.equal(
      runs.reduce((a, b) => a + b, 0),
      TOTAL_PICKS,
      "turns must tile the draft exactly"
    );
  });

  test("the opening and closing singles keep PICKS balanced", () => {
    // With the two singles removed, what is left must split into whole blocks —
    // otherwise a turn would straddle the seam and one player would be owed a
    // partial block.
    assert.equal(
      (TOTAL_PICKS - 2) % RANKED_DRAFT_CONFIG.PICKS_PER_TURN,
      0
    );
  });

  test("picksLeftInTurn follows the 1 / 2,2 / 1 shape", () => {
    assert.equal(picksLeftInTurn(0), 1, "opening turn is a single pick");
    assert.ok(isLastPickOfTurn(0), "so it also ends the turn");

    assert.equal(picksLeftInTurn(1), 2);
    assert.equal(picksLeftInTurn(2), 1);
    assert.equal(picksLeftInTurn(3), 2);

    assert.equal(
      picksLeftInTurn(TOTAL_PICKS - 1),
      1,
      "closing turn is a single pick"
    );
  });
});

describe("ranked draft: turn resolution cannot deadlock", () => {
  const MAX = RANKED_DRAFT_CONFIG.PICKS;

  test("a full player is never given the turn", () => {
    // The bug this guards: turn derived from a running index pointed at a
    // player holding 10/10 while the opponent was owed one, so every pick was
    // rejected and the draft wedged permanently.
    const picker = resolveCurrentPicker(P1, P2, MAX - 1, MAX);
    assert.equal(picker, P1, "the player still owed cards must be on turn");
  });

  test("mirror case", () => {
    assert.equal(resolveCurrentPicker(P1, P2, MAX, MAX - 1), P2);
  });

  test("returns null only when both are full", () => {
    assert.equal(resolveCurrentPicker(P1, P2, MAX, MAX), null);
    assert.ok(isDraftComplete(MAX, MAX));
    assert.ok(!isDraftComplete(MAX - 1, MAX));
  });

  test("follows the normal cadence when neither is full", () => {
    // 1 / 2,2 / 1: P1 takes one, P2 answers with two, then P1 takes two.
    assert.equal(resolveCurrentPicker(P1, P2, 0, 0), P1, "P1 opens");
    assert.equal(resolveCurrentPicker(P1, P2, 1, 0), P2, "turn passes after 1");
    assert.equal(resolveCurrentPicker(P1, P2, 1, 1), P2, "P2 takes its second");
    assert.equal(resolveCurrentPicker(P1, P2, 1, 2), P1, "back to P1 for two");
    assert.equal(resolveCurrentPicker(P1, P2, 2, 2), P1);
    assert.equal(resolveCurrentPicker(P1, P2, 3, 2), P2);
  });

  test("every reachable count pair yields a pickable player", () => {
    // Exhaustive: no combination may hand the turn to someone who cannot act.
    for (let a = 0; a <= MAX; a++) {
      for (let b = 0; b <= MAX; b++) {
        const picker = resolveCurrentPicker(P1, P2, a, b);
        if (picker === null) {
          assert.ok(a >= MAX && b >= MAX, `null turn at ${a}/${b}`);
          continue;
        }
        const held = picker === P1 ? a : b;
        assert.ok(held < MAX, `turn given to a full player at ${a}/${b}`);
      }
    }
  });
});

describe("ranked draft: power cost", () => {
  test("strips upgrade suffixes", () => {
    assert.equal(baseRarity("legendary+++"), "legendary");
    assert.equal(baseRarity("Epic++"), "epic");
  });

  test("costs match the shared rarity table", () => {
    assert.equal(cardPowerCost("legendary"), 9);
    assert.equal(cardPowerCost("epic+"), 3);
    assert.equal(cardPowerCost("rare"), 1);
    assert.equal(cardPowerCost("common"), 0);
  });

  test("an unknown rarity throws rather than costing zero", () => {
    // Silently pricing an unknown tier at 0 would let a whole rarity bypass
    // the draft power cap.
    assert.throws(() => cardPowerCost("mythic"), DraftRuleError);
    assert.throws(() => cardPowerCost(undefined), DraftRuleError);
  });

  test("the budget actually binds", () => {
    const allLegendary = RANKED_DRAFT_CONFIG.PICKS * cardPowerCost("legendary");
    assert.ok(allLegendary > RANKED_DRAFT_CONFIG.POWER_BUDGET);
  });
});

describe("ranked draft: ban secrecy", () => {
  test("bans are not in the unavailable pool until BOTH are submitted", () => {
    // Leaking one ban early through the pool would reveal it indirectly.
    const oneBan = session({ player1_ban: "banA" });
    assert.equal(bansComplete(oneBan), false);
    assert.deepEqual(unavailableCardIds(oneBan), []);
  });

  test("both bans join the pool once complete", () => {
    const both = session({ player1_ban: "banA", player2_ban: "banB" });
    assert.equal(bansComplete(both), true);
    const pool = unavailableCardIds(both);
    assert.ok(pool.includes("banA"));
    assert.ok(pool.includes("banB"));
  });

  test("picks are always unavailable", () => {
    const s = session({ player1_picks: ["c1"], player2_picks: ["c2"] });
    const pool = unavailableCardIds(s);
    assert.ok(pool.includes("c1"));
    assert.ok(pool.includes("c2"));
  });
});

describe("ranked draft: participation", () => {
  test("only the two players belong to a session", () => {
    const s = session();
    assert.ok(isParticipant(s, P1));
    assert.ok(isParticipant(s, P2));
    assert.equal(isParticipant(s, "someone-else"), false);
  });
});

describe("ranked draft: synthetic instance ids", () => {
  const variant = "2082d441-e026-4c28-8165-ceea5995a36d";

  test("copies of one pick are distinct", () => {
    assert.notEqual(draftInstanceId(variant, 0), draftInstanceId(variant, 1));
  });

  test("ids are recognisable and round-trip despite uuid dashes", () => {
    const id = draftInstanceId(variant, 1);
    assert.ok(isDraftInstanceId(id));
    assert.equal(cardVariantIdFromDraftInstanceId(id), variant);
  });

  test("real instance ids are not mistaken for draft ids", () => {
    assert.equal(isDraftInstanceId(variant), false);
    assert.equal(cardVariantIdFromDraftInstanceId(variant), null);
  });

  test("an incomplete cache is rejected loudly", () => {
    // The engine's lazy re-hydration cannot resolve a synthetic id and fails
    // SILENTLY, so this assertion is the only thing standing between a bad
    // deck build and a card going blank mid-match.
    const ids = [draftInstanceId(variant, 0), draftInstanceId(variant, 1)];
    const complete = { [ids[0]]: {} as never, [ids[1]]: {} as never };
    assert.doesNotThrow(() => assertDraftCacheComplete(ids, complete));
    assert.throws(
      () => assertDraftCacheComplete(ids, { [ids[0]]: {} as never }),
      /incomplete card cache/
    );
  });
});
