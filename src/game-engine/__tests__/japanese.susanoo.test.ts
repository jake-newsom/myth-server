import test from "node:test";
import assert from "node:assert/strict";
import { TriggerMoment } from "../../types/card.types";
import { EVENT_TYPES } from "../../types/game-engine.types";
import { simulationContext } from "../simulation.context";
import { japaneseAbilities } from "../abilities/japanese.abilities";
import {
  createEmptyBoard,
  createTestCard,
  createTestGameState,
  placeCardOnBoard,
} from "./ai.test-utils";

function play(orochiOwner: "p1" | "p2") {
  const board = createEmptyBoard();
  const susanoo = createTestCard({ id: "Susanoo", owner: "p1", abilityId: "susanoo_storm_breaker" });
  // Card names come from the id in the test factory.
  const orochi = createTestCard({ id: "Yamata no Orochi", owner: orochiOwner, tags: ["DRAGON"] });
  placeCardOnBoard(board, { x: 1, y: 1 }, susanoo);
  placeCardOnBoard(board, { x: 0, y: 0 }, orochi);
  const state = createTestGameState({ board, player1Id: "p1", player2Id: "p2" });
  const events = japaneseAbilities.susanoo_storm_breaker({
    state,
    triggerCard: susanoo,
    triggerMoment: TriggerMoment.OnPlace,
    position: { x: 1, y: 1 },
  }) as any[];
  return { events, board };
}

test("susanoo_storm_breaker gains +3 when the Orochi he destroys was in play", () => {
  simulationContext.enterSimulation();
  try {
    const { events, board } = play("p2");
    const types = events.map((e) => e.type);
    // Gain first, then destroy (the card's own order).
    assert.deepEqual(types, [EVENT_TYPES.CARD_POWER_CHANGED, EVENT_TYPES.CARD_REMOVED_FROM_BOARD]);
    assert.equal(events[0].powerDelta, 3);
    assert.equal(board[0][0].card, null);
  } finally {
    simulationContext.exitSimulation();
  }
});

test("susanoo_storm_breaker gains +3 with a friendly Orochi and destroys nothing", () => {
  simulationContext.enterSimulation();
  try {
    const { events, board } = play("p1");
    assert.deepEqual(events.map((e) => e.type), [EVENT_TYPES.CARD_POWER_CHANGED]);
    assert.ok(board[0][0].card);
  } finally {
    simulationContext.exitSimulation();
  }
});
