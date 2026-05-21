import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPlayerMulligan,
  chooseAIMulligan,
  finalizeMulliganIfReady,
  MAX_MULLIGAN_REPLACEMENTS,
} from "../../src/game-engine/game.mulligan";
import { GameStatus } from "../../src/game-engine/game.logic";
import type { GameState } from "../../src/types/game.types";
import type { InGameCard } from "../../src/types/card.types";

const PLAYER_1 = "player-1";
const AI = "AI_TEST";

function powerCard(id: string, total: number, owner: string): InGameCard {
  const each = Math.floor(total / 4);
  return {
    user_card_instance_id: id,
    base_card_id: `b-${id}`,
    level: 1,
    xp: 0,
    is_locked: false,
    power_enhancements: { top: 0, bottom: 0, left: 0, right: 0 },
    card_modifiers_positive: { top: 0, bottom: 0, left: 0, right: 0 },
    card_modifiers_negative: { top: 0, bottom: 0, left: 0, right: 0 },
    temporary_effects: [],
    current_power: { top: each, bottom: each, left: each, right: total - 3 * each },
    owner,
    original_owner: owner,
    lockedTurns: 0,
    lockedBy: null,
    defeats: [],
    base_card_data: {
      card_id: `c-${id}`,
      name: `Card ${id}`,
      rarity: "common",
      image_url: "x",
      base_power: { top: each, bottom: each, left: each, right: each },
      special_ability: null,
      tags: [],
      set_id: "test",
      attack_animation: "atk",
      is_exclusive: false,
    },
  } as any;
}

function makeMulliganState(opts?: {
  p1Hand?: string[];
  p1Deck?: string[];
  p2Hand?: string[];
  p2Deck?: string[];
}): GameState {
  const p1Hand = opts?.p1Hand ?? ["p1-h1", "p1-h2", "p1-h3", "p1-h4", "p1-h5"];
  const p1Deck = opts?.p1Deck ?? ["p1-d1", "p1-d2", "p1-d3"];
  const p2Hand = opts?.p2Hand ?? ["p2-h1", "p2-h2", "p2-h3", "p2-h4", "p2-h5"];
  const p2Deck = opts?.p2Deck ?? ["p2-d1", "p2-d2", "p2-d3"];

  const cache: Record<string, InGameCard> = {};
  [...p1Hand, ...p1Deck].forEach((id, i) => (cache[id] = powerCard(id, 10 + i, PLAYER_1)));
  [...p2Hand, ...p2Deck].forEach((id, i) => (cache[id] = powerCard(id, 10 + i, AI)));

  return {
    board: [],
    player1: { user_id: PLAYER_1, hand: [...p1Hand], deck: [...p1Deck], discard_pile: [], score: 0 } as any,
    player2: { user_id: AI, hand: [...p2Hand], deck: [...p2Deck], discard_pile: [], score: 0 } as any,
    current_player_id: PLAYER_1,
    turn_number: 1,
    status: GameStatus.MULLIGAN,
    max_cards_in_hand: 10,
    initial_cards_to_draw: 5,
    winner: null,
    hydrated_card_data_cache: cache,
    mulligan_state: {
      player1: { committed: false, replaced_count: 0 },
      player2: { committed: false, replaced_count: 0 },
    },
  } as any;
}

test("applyPlayerMulligan: swaps 2 cards — discards to deck bottom, draws from top", () => {
  const state = makeMulliganState();
  const result = applyPlayerMulligan(state, PLAYER_1, ["p1-h2", "p1-h4"]);
  assert.equal(result.state.player1.hand.length, 5);
  // Drawn cards are the first two from the original deck.
  assert.ok(result.state.player1.hand.includes("p1-d1"));
  assert.ok(result.state.player1.hand.includes("p1-d2"));
  // Discarded cards are now at deck bottom.
  assert.equal(result.state.player1.deck[result.state.player1.deck.length - 2], "p1-h2");
  assert.equal(result.state.player1.deck[result.state.player1.deck.length - 1], "p1-h4");
  assert.equal(result.state.mulligan_state!.player1.committed, true);
  assert.equal(result.state.mulligan_state!.player1.replaced_count, 2);
  assert.equal(result.events.length, 1);
  assert.equal((result.events[0] as any).type, "mulligan_applied");
});

test("applyPlayerMulligan: 0 ids → keep hand, marks committed, no draws", () => {
  const state = makeMulliganState();
  const originalHand = [...state.player1.hand];
  const result = applyPlayerMulligan(state, PLAYER_1, []);
  assert.deepEqual(result.state.player1.hand, originalHand);
  assert.equal(result.state.mulligan_state!.player1.committed, true);
  assert.equal(result.state.mulligan_state!.player1.replaced_count, 0);
});

test("applyPlayerMulligan: rejects > MAX_MULLIGAN_REPLACEMENTS", () => {
  const state = makeMulliganState();
  assert.throws(() => applyPlayerMulligan(state, PLAYER_1, ["p1-h1", "p1-h2", "p1-h3"]));
});

test("applyPlayerMulligan: rejects when player already committed", () => {
  const state = makeMulliganState();
  state.mulligan_state!.player1.committed = true;
  assert.throws(() => applyPlayerMulligan(state, PLAYER_1, ["p1-h1"]));
});

test("applyPlayerMulligan: rejects when status not MULLIGAN", () => {
  const state = makeMulliganState();
  state.status = GameStatus.ACTIVE;
  assert.throws(() => applyPlayerMulligan(state, PLAYER_1, []));
});

test("applyPlayerMulligan: rejects unknown card id", () => {
  const state = makeMulliganState();
  assert.throws(() => applyPlayerMulligan(state, PLAYER_1, ["not-in-hand"]));
});

test("chooseAIMulligan: returns ids from bottom-25% power bucket", () => {
  // Hand power sums: 10,20,30,40,50 — bottom 25% threshold around 20 → ids of 10 and 20.
  const cache: Record<string, InGameCard> = {};
  const hand = ["a", "b", "c", "d", "e"];
  hand.forEach((id, i) => (cache[id] = powerCard(id, 10 * (i + 1), AI)));
  const state = makeMulliganState({ p2Hand: hand });
  state.hydrated_card_data_cache = { ...state.hydrated_card_data_cache, ...cache };

  const chosen = chooseAIMulligan(state, AI);
  assert.ok(chosen.length <= MAX_MULLIGAN_REPLACEMENTS);
  // Both chosen ids must have power-sum ≤ threshold (~20)
  for (const id of chosen) {
    const c = cache[id];
    const sum = c.current_power.top + c.current_power.bottom + c.current_power.left + c.current_power.right;
    assert.ok(sum <= 20, `expected ${sum} ≤ 20`);
  }
});

test("chooseAIMulligan: returns [] when all power sums equal", () => {
  const cache: Record<string, InGameCard> = {};
  const hand = ["a", "b", "c", "d", "e"];
  hand.forEach((id) => (cache[id] = powerCard(id, 20, AI)));
  const state = makeMulliganState({ p2Hand: hand });
  state.hydrated_card_data_cache = { ...state.hydrated_card_data_cache, ...cache };
  assert.deepEqual(chooseAIMulligan(state, AI), []);
});

test("finalizeMulliganIfReady: no-op when only one committed", () => {
  const state = makeMulliganState();
  state.mulligan_state!.player1.committed = true;
  const r = finalizeMulliganIfReady(state);
  assert.equal(r.transitioned, false);
  assert.equal(r.state.status, GameStatus.MULLIGAN);
});

test("finalizeMulliganIfReady: flips to ACTIVE when both committed", () => {
  const state = makeMulliganState();
  state.mulligan_state!.player1.committed = true;
  state.mulligan_state!.player2.committed = true;
  const r = finalizeMulliganIfReady(state);
  assert.equal(r.transitioned, true);
  assert.equal(r.state.status, GameStatus.ACTIVE);
});

test("finalizeMulliganIfReady: idempotent after transition", () => {
  const state = makeMulliganState();
  state.mulligan_state!.player1.committed = true;
  state.mulligan_state!.player2.committed = true;
  const first = finalizeMulliganIfReady(state);
  const second = finalizeMulliganIfReady(first.state);
  assert.equal(second.transitioned, false);
  assert.equal(second.state.status, GameStatus.ACTIVE);
});
