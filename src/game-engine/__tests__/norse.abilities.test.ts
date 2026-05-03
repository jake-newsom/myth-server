import test from "node:test";
import assert from "node:assert/strict";
import { TriggerMoment } from "../../types/card.types";
import { simulationContext } from "../simulation.context";
import { norseAbilities } from "../abilities/norse.abilities";
import {
  createEmptyBoard,
  createTestCard,
  createTestGameState,
  placeCardOnBoard,
} from "./ai.test-utils";

test("vidar_vengeance buffs only Vidar when Odin has been defeated", () => {
  simulationContext.enterSimulation();
  try {
    const board = createEmptyBoard();

    const vidar = createTestCard({
      id: "vidar",
      owner: "p1",
      abilityId: "vidar_vengeance",
    });
    vidar.base_card_data.name = "Vidar";

    const ally = createTestCard({
      id: "ally",
      owner: "p1",
    });

    const defeatedOdin = createTestCard({
      id: "odin",
      owner: "p2",
    });
    defeatedOdin.base_card_data.name = "Odin";
    defeatedOdin.defeats.push({
      user_card_instance_id: "defeater",
      base_card_id: "base-defeater",
      name: "Defeater",
    });

    placeCardOnBoard(board, { x: 1, y: 1 }, vidar);
    placeCardOnBoard(board, { x: 1, y: 2 }, ally);
    placeCardOnBoard(board, { x: 0, y: 0 }, defeatedOdin);

    const state = createTestGameState({
      board,
      player1Id: "p1",
      player2Id: "p2",
    });

    const events = norseAbilities.vidar_vengeance({
      state,
      triggerCard: vidar,
      triggerMoment: TriggerMoment.OnPlace,
      position: { x: 1, y: 1 },
    });

    assert.equal(events.length, 1);
    assert.ok("cardId" in events[0]);
    assert.equal((events[0] as unknown as { cardId: string }).cardId, "vidar");
    assert.equal(vidar.temporary_effects.length, 1);
    assert.equal(ally.temporary_effects.length, 0);
  } finally {
    simulationContext.exitSimulation();
  }
});
