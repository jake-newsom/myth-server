import test from "node:test";
import assert from "node:assert/strict";
import {
  batchContainsDebuff,
  triggerDebuffDeckEffects,
} from "../deck.effects";
import { addTempBuff, addTempDebuff } from "../ability.utils";
import { simulationContext } from "../simulation.context";
import {
  createEmptyBoard,
  createTestCard,
  createTestGameState,
} from "./ai.test-utils";

const POSITION = { x: 0, y: 0 };

test("batchContainsDebuff: a debuff event counts, a buff event does not", () => {
  const target = createTestCard({ id: "target", owner: "p1" });
  const debuffEvent = addTempDebuff(target, 3, -2, {
    name: "Test Debuff",
    position: POSITION,
  });
  const buffEvent = addTempBuff(target, 3, 2, {
    name: "Test Buff",
    position: POSITION,
  });

  assert.equal(batchContainsDebuff([buffEvent]), false);
  assert.equal(batchContainsDebuff([buffEvent, debuffEvent]), true);
  assert.equal(batchContainsDebuff([]), false);
});

test("japanese deck effect fires on a debuff event, once per round", () => {
  simulationContext.enterSimulation();
  try {
    const handCard = createTestCard({ id: "p2-hand", owner: "p2" });
    const target = createTestCard({ id: "target", owner: "p1" });
    const state = createTestGameState({
      board: createEmptyBoard(),
      player1Id: "p1",
      player2Id: "p2",
      player2Hand: ["p2-hand"],
      hydrated: { "p2-hand": handCard, target },
    });
    state.player2.deck_effect = "japanese";
    state.turn_number = 1;

    const debuffEvent = addTempDebuff(target, 3, -2, {
      name: "Test Debuff",
      position: POSITION,
    });

    const events = triggerDebuffDeckEffects(state, [debuffEvent]);
    assert.ok(
      events.some(
        (e) => "effectName" in e && e.effectName === "Measured Technique"
      ),
      "expected the passive to fire on a plain debuff"
    );

    // Same round: the once-per-round limiter blocks a second trigger.
    const again = triggerDebuffDeckEffects(state, [debuffEvent]);
    assert.equal(again.length, 0);
  } finally {
    simulationContext.exitSimulation();
  }
});

test("japanese deck effect does not fire when nothing was debuffed", () => {
  simulationContext.enterSimulation();
  try {
    const handCard = createTestCard({ id: "p2-hand", owner: "p2" });
    const target = createTestCard({ id: "target", owner: "p1" });
    const state = createTestGameState({
      board: createEmptyBoard(),
      player1Id: "p1",
      player2Id: "p2",
      player2Hand: ["p2-hand"],
      hydrated: { "p2-hand": handCard, target },
    });
    state.player2.deck_effect = "japanese";

    const buffEvent = addTempBuff(target, 3, 2, {
      name: "Test Buff",
      position: POSITION,
    });

    assert.equal(triggerDebuffDeckEffects(state, [buffEvent]).length, 0);
  } finally {
    simulationContext.exitSimulation();
  }
});

test("japanese deck effect does not fire for a non-japanese deck", () => {
  simulationContext.enterSimulation();
  try {
    const handCard = createTestCard({ id: "p2-hand", owner: "p2" });
    const target = createTestCard({ id: "target", owner: "p1" });
    const state = createTestGameState({
      board: createEmptyBoard(),
      player1Id: "p1",
      player2Id: "p2",
      player2Hand: ["p2-hand"],
      hydrated: { "p2-hand": handCard, target },
    });
    state.player2.deck_effect = "norse";

    const debuffEvent = addTempDebuff(target, 3, -2, {
      name: "Test Debuff",
      position: POSITION,
    });

    assert.equal(triggerDebuffDeckEffects(state, [debuffEvent]).length, 0);
  } finally {
    simulationContext.exitSimulation();
  }
});
