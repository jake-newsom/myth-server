import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EVENT_TYPES } from "../../src/types/game-engine.types";
import { resolveCombat } from "../../src/game-engine/game.utils";
import {
  createTestCard,
  createEmptyBoard,
  createTestGameState,
  placeCardOnBoard,
} from "../../src/game-engine/__tests__/ai.test-utils";

function jormungandr(id: string, owner: string, power: number) {
  const card = createTestCard({
    id,
    owner,
    power: { top: power, right: power, bottom: power, left: power },
  });
  card.base_card_data.name = "Jormungandr";
  card.base_card_data.special_ability = {
    ability_id: "jormungandr_shell",
    id: "jormungandr_shell",
    name: "Titan Shell",
    description: "Can only be defeated by Thor.",
    parameters: {},
    triggerMoments: [],
  };
  return card;
}

describe("jormungandr_shell ally protection", () => {
  it("Thor still flips a Jormungandr when a second allied Jormungandr is on board", () => {
    const board = createEmptyBoard();

    // Two enemy Jormungandr cards.
    const target = jormungandr("jorm-1", "p2", 11);
    const allyJorm = jormungandr("jorm-2", "p2", 11);

    // Thor placed adjacent to target (below it), with right power 12.
    const thor = createTestCard({
      id: "thor",
      owner: "p1",
      power: { top: 12, right: 12, bottom: 12, left: 12 },
    });
    thor.base_card_data.name = "Thor";

    // target at (0,0), thor below it at (0,1) -> thor.top vs target.bottom
    placeCardOnBoard(board, { x: 0, y: 0 }, target);
    placeCardOnBoard(board, { x: 1, y: 0 }, allyJorm); // ally adjacent to target, same owner
    placeCardOnBoard(board, { x: 0, y: 1 }, thor);

    const state = createTestGameState({ board, player1Id: "p1", player2Id: "p2" });

    const { events } = resolveCombat(state, { x: 0, y: 1 }, "p1");

    const flipEvents = events.filter((e) => e.type === EVENT_TYPES.CARD_FLIPPED);
    const defendEvents = events.filter((e) => e.type === EVENT_TYPES.CARD_DEFENDED);

    assert.equal(flipEvents.length, 1, "Thor should flip the Jormungandr");
    assert.equal((flipEvents[0] as any).cardId, "jorm-1");
    assert.equal(defendEvents.length, 0);
  });

  it("a non-Thor card cannot flip Jormungandr even without an ally present", () => {
    const board = createEmptyBoard();

    const target = jormungandr("jorm-1", "p2", 11);

    const attacker = createTestCard({
      id: "attacker",
      owner: "p1",
      power: { top: 12, right: 12, bottom: 12, left: 12 },
    });
    attacker.base_card_data.name = "Odin";

    placeCardOnBoard(board, { x: 0, y: 0 }, target);
    placeCardOnBoard(board, { x: 0, y: 1 }, attacker);

    const state = createTestGameState({ board, player1Id: "p1", player2Id: "p2" });

    const { events } = resolveCombat(state, { x: 0, y: 1 }, "p1");

    const flipEvents = events.filter((e) => e.type === EVENT_TYPES.CARD_FLIPPED);
    const defendEvents = events.filter((e) => e.type === EVENT_TYPES.CARD_DEFENDED);

    assert.equal(flipEvents.length, 0, "non-Thor should not flip Jormungandr");
    assert.equal(defendEvents.length, 1);
  });
});
