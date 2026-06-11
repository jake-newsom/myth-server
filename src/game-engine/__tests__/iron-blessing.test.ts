import test from "node:test";
import assert from "node:assert/strict";
import {
  addTempDebuff,
  isImmuneToNegativeEffects,
  updateCurrentPower,
} from "../ability.utils";
import { simulationContext } from "../simulation.context";
import { EVENT_TYPES } from "../game-events";
import { applyThornsOnFlips } from "../sagaBattle.mechanics";
import {
  createTestCard,
  createEmptyBoard,
  createTestGameState,
  placeCardOnBoard,
} from "./ai.test-utils";

test("isImmuneToNegativeEffects is true only for iron-blessed cards", () => {
  const ironCard = createTestCard({ id: "iron-card", owner: "p1" });
  ironCard.saga_rune_type = "iron";
  assert.equal(isImmuneToNegativeEffects(ironCard), true);

  const plainCard = createTestCard({ id: "plain-card", owner: "p1" });
  assert.equal(isImmuneToNegativeEffects(plainCard), false);

  const otherRuneCard = createTestCard({ id: "thorns-card", owner: "p1" });
  otherRuneCard.saga_rune_type = "thorns";
  assert.equal(isImmuneToNegativeEffects(otherRuneCard), false);
});

test("addTempDebuff blocks debuffs on an iron-blessed card and reports protected", () => {
  simulationContext.enterSimulation();
  try {
    const card = createTestCard({ id: "iron-card", owner: "p1" });
    card.saga_rune_type = "iron";

    const event = addTempDebuff(card, 1000, 2, {
      position: { x: 0, y: 0 },
      name: "Test Debuff",
    });

    assert.equal(card.temporary_effects.length, 0);
    assert.equal((event as any).powerDelta, 0);
    assert.equal((event as any).animation, "protected");
    assert.equal((event as any).effectName, "Test Debuff");
  } finally {
    simulationContext.exitSimulation();
  }
});

test("addTempDebuff applies normally to a non-iron card", () => {
  simulationContext.enterSimulation();
  try {
    const card = createTestCard({ id: "plain-card", owner: "p1" });

    const event = addTempDebuff(card, 1000, -2, {
      position: { x: 0, y: 0 },
      name: "Test Debuff",
    });

    assert.equal(card.temporary_effects.length, 1);
    assert.equal(card.temporary_effects[0].power.top, -2);
    assert.equal((event as any).powerDelta, -2);
    assert.equal((event as any).animation, "debuff");
  } finally {
    simulationContext.exitSimulation();
  }
});

test("Thorns retaliation is blocked when the attacker is iron-blessed", () => {
  const board = createEmptyBoard();

  const thornsCard = createTestCard({ id: "thorns-card", owner: "p2" });
  thornsCard.saga_rune_type = "thorns";

  const attacker = createTestCard({ id: "iron-attacker", owner: "p1" });
  attacker.saga_rune_type = "iron";

  placeCardOnBoard(board, { x: 0, y: 0 }, thornsCard);
  placeCardOnBoard(board, { x: 1, y: 1 }, attacker);

  const state = createTestGameState({ board, player1Id: "p1", player2Id: "p2" });

  const flips = [
    {
      type: EVENT_TYPES.CARD_FLIPPED,
      eventId: "flip-1",
      timestamp: Date.now(),
      cardId: "thorns-card",
      sourceCardId: "iron-attacker",
      sourcePlayerId: "p1",
      position: { x: 0, y: 0 },
    } as any,
  ];

  const { events } = applyThornsOnFlips(state, flips);

  assert.equal(attacker.temporary_effects.length, 0);
  assert.equal(events.length, 1);
  assert.equal((events[0] as any).powerDelta, 0);
  assert.equal((events[0] as any).animation, "protected");
  assert.equal((events[0] as any).effectName, "Thorns Blessing");
});

test("Thorns retaliation still applies to a non-iron attacker", () => {
  const board = createEmptyBoard();

  const thornsCard = createTestCard({ id: "thorns-card", owner: "p2" });
  thornsCard.saga_rune_type = "thorns";

  const attacker = createTestCard({ id: "plain-attacker", owner: "p1" });

  placeCardOnBoard(board, { x: 0, y: 0 }, thornsCard);
  placeCardOnBoard(board, { x: 1, y: 1 }, attacker);

  const state = createTestGameState({ board, player1Id: "p1", player2Id: "p2" });

  const flips = [
    {
      type: EVENT_TYPES.CARD_FLIPPED,
      eventId: "flip-1",
      timestamp: Date.now(),
      cardId: "thorns-card",
      sourceCardId: "plain-attacker",
      sourcePlayerId: "p1",
      position: { x: 0, y: 0 },
    } as any,
  ];

  const { events } = applyThornsOnFlips(state, flips);

  assert.equal(attacker.temporary_effects.length, 1);
  assert.equal(attacker.temporary_effects[0].type, "debuff");
  assert.equal(attacker.temporary_effects[0].power.top, -2);
  assert.equal(events.length, 1);
  assert.equal((events[0] as any).powerDelta, -2);
  assert.equal((events[0] as any).effectName, "Thorns Blessing");
});

test("updateCurrentPower no longer floors iron-blessed cards at base power", () => {
  const card = createTestCard({
    id: "iron-card",
    owner: "p1",
    power: { top: 4, right: 4, bottom: 4, left: 4 },
  });
  card.saga_rune_type = "iron";
  // Manually populate a temporary effect to exercise the power-calc path
  // directly, independent of addTempDebuff's blocking behavior.
  card.temporary_effects = [
    {
      type: "debuff" as any,
      duration: 1000,
      power: { top: -2, right: -2, bottom: -2, left: -2 },
    },
  ];

  const result = updateCurrentPower(card);

  assert.deepEqual(result, { top: 2, right: 2, bottom: 2, left: 2 });
});

test("updateCurrentPower clamps a non-iron card's power at 0", () => {
  const card = createTestCard({
    id: "plain-card",
    owner: "p1",
    power: { top: 1, right: 1, bottom: 1, left: 1 },
  });
  card.temporary_effects = [
    {
      type: "debuff" as any,
      duration: 1000,
      power: { top: -5, right: -5, bottom: -5, left: -5 },
    },
  ];

  const result = updateCurrentPower(card);

  assert.deepEqual(result, { top: 0, right: 0, bottom: 0, left: 0 });
});
