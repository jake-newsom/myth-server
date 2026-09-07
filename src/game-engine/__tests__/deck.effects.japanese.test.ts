import test from "node:test";
import assert from "node:assert/strict";
import {
  batchContainsDebuff,
  triggerDebuffDeckEffects,
} from "../deck.effects";
import {
  addTempBuff,
  addTempDebuff,
  createOrUpdateDebuff,
} from "../ability.utils";
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

test("createOrUpdateDebuff events count as debuffs", () => {
  // Regression: createOrUpdateDebuff never set isNegativeEffect, so every
  // debuff routed through it (Frigg's hand debuff, Moon's Balance, and the
  // stacking debuffs generally) was invisible to batchContainsDebuff and never
  // triggered Measured Technique.
  const target = createTestCard({ id: "target", owner: "p1" });
  const event = createOrUpdateDebuff(
    target,
    1000,
    2,
    "Stacking Debuff",
    POSITION
  );

  assert.equal(batchContainsDebuff([event]), true);
});

test("a zero-magnitude debuff initialization does not count as a debuff", () => {
  // createOrUpdateDebuff seeds a new effect via addTempDebuff(..., 0, ...);
  // that seeding call must not by itself register as a debuff.
  const target = createTestCard({ id: "target", owner: "p1" });
  const event = createOrUpdateDebuff(target, 1000, 0, "Empty", POSITION);

  assert.equal(batchContainsDebuff([event]), false);
});

test("the once-per-round limiter allows one trigger in each successive round", () => {
  // Regression: the turn-end debuff check ran before turn_number++, stamping
  // start-of-turn debuffs with the outgoing turn's round. That blocked the
  // incoming player's own placement, so the passive fired every OTHER round.
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

    const fireInRound = (turnNumber: number) => {
      state.turn_number = turnNumber;
      const debuffEvent = addTempDebuff(target, 3, -2, {
        name: "Test Debuff",
        position: POSITION,
      });
      return triggerDebuffDeckEffects(state, [debuffEvent]).length > 0;
    };

    // Round 1 (turns 1-2), round 2 (turns 3-4), round 3 (turns 5-6).
    assert.equal(fireInRound(1), true, "round 1 should fire");
    assert.equal(fireInRound(2), false, "same round, already fired");
    assert.equal(fireInRound(3), true, "round 2 should fire");
    assert.equal(fireInRound(5), true, "round 3 should fire");
  } finally {
    simulationContext.exitSimulation();
  }
});
