import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collectDeckCardResults,
  resultFor,
} from "../gameCardResults.service";

const ME = "11111111-1111-1111-1111-111111111111";
const AI = "00000000-0000-0000-0000-000000000000";

function card(id: string, owner: string, original = owner) {
  return { user_card_instance_id: id, owner, original_owner: original };
}

function makeState(): any {
  const board = [
    [{ card: card("me-board", ME) }, { card: card("me-flipped", AI, ME) }],
    [{ card: card("ai-board", AI) }, { card: card("ai-flipped-to-me", ME, AI) }],
  ];
  const cache: Record<string, any> = {};
  for (const id of ["me-hand", "me-deck", "me-discard", "me-board", "me-flipped"]) {
    cache[id] = { base_card_data: { card_id: `v-${id}`, character_id: `c-${id}` } };
  }
  return {
    board,
    player1: { user_id: ME, hand: ["me-hand"], deck: ["me-deck"], discard_pile: ["me-discard"] },
    player2: { user_id: AI, hand: ["ai-hand"], deck: [], discard_pile: ["ai-discard"] },
    hydrated_card_data_cache: cache,
  };
}

test("collects every card the player brought, by original owner", () => {
  const rows = collectDeckCardResults(makeState(), ME);
  const ids = rows.map((r) => r.card_instance_id).sort();
  assert.deepEqual(ids, ["me-board", "me-deck", "me-discard", "me-flipped", "me-hand"]);
});

test("was_played is true for discard and board cards only", () => {
  const byId = Object.fromEntries(
    collectDeckCardResults(makeState(), ME).map((r) => [r.card_instance_id, r]),
  );
  assert.equal(byId["me-hand"].was_played, false);
  assert.equal(byId["me-deck"].was_played, false);
  assert.equal(byId["me-discard"].was_played, true);
  assert.equal(byId["me-board"].was_played, true);
  assert.equal(byId["me-flipped"].was_played, true);
});

test("maps character and variant ids from the hydrated cache", () => {
  const row = collectDeckCardResults(makeState(), ME).find(
    (r) => r.card_instance_id === "me-hand",
  )!;
  assert.equal(row.character_id, "c-me-hand");
  assert.equal(row.variant_id, "v-me-hand");
});

test("unknown player yields no rows", () => {
  assert.deepEqual(collectDeckCardResults(makeState(), "nobody"), []);
});

test("resultFor", () => {
  assert.equal(resultFor(ME, ME), "win");
  assert.equal(resultFor(AI, ME), "loss");
  assert.equal(resultFor(null, ME), "draw");
});
