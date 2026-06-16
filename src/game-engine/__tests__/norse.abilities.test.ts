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

test("njord_sea buffs when adjacent to a sea-tagged card", () => {
  simulationContext.enterSimulation();
  try {
    const board = createEmptyBoard();

    const njord = createTestCard({
      id: "njord",
      owner: "p1",
      abilityId: "njord_sea",
    });
    njord.base_card_data.tags = ["norse", "god", "sea"];

    const seaAlly = createTestCard({
      id: "sea-ally",
      owner: "p1",
    });
    seaAlly.base_card_data.tags = ["norse", "human", "sea"];

    placeCardOnBoard(board, { x: 1, y: 1 }, seaAlly);
    placeCardOnBoard(board, { x: 1, y: 0 }, njord);

    const state = createTestGameState({
      board,
      player1Id: "p1",
      player2Id: "p2",
    });

    const events = norseAbilities.njord_sea({
      state,
      triggerCard: njord,
      triggerMoment: TriggerMoment.OnPlace,
      position: { x: 1, y: 0 },
    });

    assert.equal(events.length, 1);
    assert.equal(njord.temporary_effects.length, 1);
    assert.equal(njord.temporary_effects[0].power.top, 3);
    assert.equal(
      (events[0] as unknown as { effectName: string }).effectName,
      "Nóatún’s Guard",
    );
  } finally {
    simulationContext.exitSimulation();
  }
});

test("njord_sea does not buff without an adjacent sea-tagged card", () => {
  simulationContext.enterSimulation();
  try {
    const board = createEmptyBoard();

    const njord = createTestCard({
      id: "njord",
      owner: "p1",
      abilityId: "njord_sea",
    });
    njord.base_card_data.tags = ["norse", "god", "sea"];

    const nonSeaAlly = createTestCard({
      id: "ally",
      owner: "p1",
    });
    nonSeaAlly.base_card_data.tags = ["norse", "human", "warrior"];

    placeCardOnBoard(board, { x: 1, y: 1 }, nonSeaAlly);
    placeCardOnBoard(board, { x: 1, y: 0 }, njord);

    const state = createTestGameState({
      board,
      player1Id: "p1",
      player2Id: "p2",
    });

    const events = norseAbilities.njord_sea({
      state,
      triggerCard: njord,
      triggerMoment: TriggerMoment.OnPlace,
      position: { x: 1, y: 0 },
    });

    assert.equal(events.length, 0);
    assert.equal(njord.temporary_effects.length, 0);
  } finally {
    simulationContext.exitSimulation();
  }
});

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
