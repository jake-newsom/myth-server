import test from "node:test";
import assert from "node:assert/strict";
import { TriggerMoment } from "../../types/card.types";
import { TileTerrain } from "../../types/game.types";
import { EVENT_TYPES } from "../../types/game-engine.types";
import { simulationContext } from "../simulation.context";
import { polynesianAbilities } from "../abilities/polynesian.abilities";
import {
  createEmptyBoard,
  createTestCard,
  createTestGameState,
  placeCardOnBoard,
} from "./ai.test-utils";

test("hauwahine_rains_blessing floods a random empty tile with a friendly +1 water tile each round", () => {
  simulationContext.enterSimulation();
  try {
    const board = createEmptyBoard();

    const hauwahine = createTestCard({
      id: "hauwahine",
      owner: "p1",
      abilityId: "hauwahine_rains_blessing",
    });
    placeCardOnBoard(board, { x: 0, y: 0 }, hauwahine);

    const state = createTestGameState({
      board,
      player1Id: "p1",
      player2Id: "p2",
    });

    const events = polynesianAbilities.hauwahine_rains_blessing({
      state,
      triggerCard: hauwahine,
      triggerMoment: TriggerMoment.OnRoundStart,
      position: { x: 0, y: 0 },
    });

    assert.equal(events.length, 1);

    const event = events[0] as unknown as {
      type: string;
      position: { x: number; y: number };
      tile: { tile_effect: any };
    };
    assert.equal(event.type, EVENT_TYPES.TILE_STATE_CHANGED);

    const effect = event.tile.tile_effect;
    assert.equal(effect.terrain, TileTerrain.Ocean);
    assert.deepEqual(effect.power, { top: 1, bottom: 1, left: 1, right: 1 });
    // Buff only applies to this card owner's cards, mirroring Wild Shift's
    // owner-scoped (enemy-scoped there) lava tile.
    assert.equal(effect.applies_to_user, "p1");

    // The chosen tile is empty and not Hauwahine's own occupied tile.
    assert.ok(!(event.position.x === 0 && event.position.y === 0));
    const chosenTile = board[event.position.y][event.position.x];
    assert.equal(chosenTile.card, null);
    assert.equal(chosenTile.tile_effect?.terrain, TileTerrain.Ocean);
  } finally {
    simulationContext.exitSimulation();
  }
});

test("hauwahine_rains_blessing is a no-op when the board has no empty tiles", () => {
  simulationContext.enterSimulation();
  try {
    const board = createEmptyBoard();

    const hauwahine = createTestCard({
      id: "hauwahine",
      owner: "p1",
      abilityId: "hauwahine_rains_blessing",
    });

    // Fill every tile so getRandomEmptyTile finds nothing.
    for (let y = 0; y < board.length; y++) {
      for (let x = 0; x < board[y].length; x++) {
        placeCardOnBoard(
          board,
          { x, y },
          x === 0 && y === 0
            ? hauwahine
            : createTestCard({ id: `filler-${x}-${y}`, owner: "p1" }),
        );
      }
    }

    const state = createTestGameState({
      board,
      player1Id: "p1",
      player2Id: "p2",
    });

    const events = polynesianAbilities.hauwahine_rains_blessing({
      state,
      triggerCard: hauwahine,
      triggerMoment: TriggerMoment.OnRoundStart,
      position: { x: 0, y: 0 },
    });

    assert.equal(events.length, 0);
  } finally {
    simulationContext.exitSimulation();
  }
});
