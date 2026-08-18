import { test, describe } from "node:test";
import assert from "node:assert";

import { applyTowerPoisonEffect } from "../deck.effects";
import type { GameState } from "../../types/game.types";
import type { InGameCard, PowerValues } from "../../types/card.types";
import type { CardPowerChangedEvent } from "../../types/game-engine.types";

const HUMAN = "p1";
const AI = "ai";

function makeCard(id: string, power: PowerValues): InGameCard {
  return {
    user_card_instance_id: id,
    owner: HUMAN,
    base_card_data: { name: `Card ${id}`, base_power: { ...power } },
    current_power: { ...power },
    power_enhancements: { top: 0, right: 0, bottom: 0, left: 0 },
    temporary_effects: [],
    card_modifiers_positive: { top: 0, right: 0, bottom: 0, left: 0 },
    card_modifiers_negative: { top: 0, right: 0, bottom: 0, left: 0 },
  } as unknown as InGameCard;
}

function makeState(
  modifiers: unknown[] | undefined,
  { hand = ["c1"], floor = 160 } = {}
): { state: GameState; card: InGameCard } {
  const card = makeCard("c1", { top: 5, right: 5, bottom: 5, left: 5 });
  const state = {
    player1: { user_id: HUMAN, hand },
    player2: { user_id: AI, hand: [] },
    hydrated_card_data_cache: { c1: card },
    ...(modifiers
      ? { tower_context: { floor_number: floor, modifiers } }
      : {}),
  } as unknown as GameState;
  return { state, card };
}

const POISON_1 = {
  type: "poison",
  value: 1,
  label: "Creeping Venom",
  description: "d",
};

describe("applyTowerPoisonEffect", () => {
  test("debuffs a hand card with a NEGATIVE per-side delta", () => {
    const { state, card } = makeState([POISON_1]);

    const events = applyTowerPoisonEffect(state, HUMAN);

    assert.equal(events.length, 1);
    const event = events[0] as CardPowerChangedEvent;
    // The whole point of the sign normalization in addTempDebuff: a debuff must
    // never tick UP in the client's per-side display.
    for (const side of ["top", "right", "bottom", "left"] as const) {
      assert.ok(
        (event.powerBySide?.[side] ?? 0) < 0,
        `${side} delta should be negative, got ${event.powerBySide?.[side]}`
      );
    }
    assert.equal(card.current_power.top, 4);
  });

  test("emits at the hand sentinel so text never lands on a board tile", () => {
    const { state } = makeState([POISON_1]);

    const event = applyTowerPoisonEffect(state, HUMAN)[0] as CardPowerChangedEvent;

    assert.deepEqual(event.position, { x: -1, y: -1 });
  });

  test("uses the modifier's authored label as the effect name", () => {
    const { state } = makeState([POISON_1]);

    const event = applyTowerPoisonEffect(state, HUMAN)[0] as CardPowerChangedEvent;

    assert.equal(event.effectName, "Creeping Venom");
  });

  test("scales with the modifier value", () => {
    const { state, card } = makeState([{ ...POISON_1, value: 2 }], {
      floor: 400,
    });

    applyTowerPoisonEffect(state, HUMAN);

    assert.equal(card.current_power.top, 3);
  });

  test("does not poison the AI", () => {
    const { state } = makeState([POISON_1]);

    assert.deepEqual(applyTowerPoisonEffect(state, AI), []);
  });

  test("is a no-op without a tower_context", () => {
    const { state } = makeState(undefined);

    assert.deepEqual(applyTowerPoisonEffect(state, HUMAN), []);
  });

  test("is a no-op when the floor has no poison modifier", () => {
    const { state } = makeState([
      { type: "no_legendary", label: "Mortal Trial", description: "d" },
    ]);

    assert.deepEqual(applyTowerPoisonEffect(state, HUMAN), []);
  });

  test("is a no-op with an empty hand", () => {
    const { state } = makeState([POISON_1], { hand: [] });

    assert.deepEqual(applyTowerPoisonEffect(state, HUMAN), []);
  });

  test("keeps the hydration cache in sync with the debuffed card", () => {
    const { state, card } = makeState([POISON_1]);

    applyTowerPoisonEffect(state, HUMAN);

    assert.equal(
      state.hydrated_card_data_cache?.["c1"].current_power.top,
      card.current_power.top
    );
  });
});
