import test from "node:test";
import assert from "node:assert/strict";
import { COMBAT_TYPES, EVENT_TYPES } from "../../types/game-engine.types";
import type { CardEvent } from "../../types/game-engine.types";
import { simulationContext } from "../simulation.context";
import { flipCard, resolveCombat } from "../game.utils";
import {
  createEmptyBoard,
  createTestCard,
  createTestGameState,
  placeCardOnBoard,
} from "./ai.test-utils";

const combatEvents = (events: unknown[]) =>
  (events as CardEvent[]).filter(
    (e) => e.type === EVENT_TYPES.CARD_FLIPPED || e.type === EVENT_TYPES.CARD_DEFENDED,
  );

test("clash payload: sides, outcomes and clockwise order in all four directions", () => {
  simulationContext.enterSimulation();
  try {
    const board = createEmptyBoard();
    const attacker = createTestCard({
      id: "atk",
      owner: "p1",
      power: { top: 5, right: 5, bottom: 5, left: 5 },
    });
    // top neighbor faces with bottom=4 → win; right faces left=5 → tie;
    // bottom faces top=6 → lose; left faces right=3 → win.
    placeCardOnBoard(board, { x: 2, y: 1 }, createTestCard({ id: "up", owner: "p2", power: { top: 9, right: 9, bottom: 4, left: 9 } }));
    placeCardOnBoard(board, { x: 3, y: 2 }, createTestCard({ id: "right", owner: "p2", power: { top: 1, right: 1, bottom: 1, left: 5 } }));
    placeCardOnBoard(board, { x: 2, y: 3 }, createTestCard({ id: "down", owner: "p2", power: { top: 6, right: 1, bottom: 1, left: 1 } }));
    placeCardOnBoard(board, { x: 1, y: 2 }, createTestCard({ id: "left", owner: "p2", power: { top: 9, right: 3, bottom: 9, left: 9 } }));
    placeCardOnBoard(board, { x: 2, y: 2 }, attacker);
    const state = createTestGameState({ board, player1Id: "p1", player2Id: "p2" });

    const events = combatEvents(resolveCombat(state, { x: 2, y: 2 }, "p1").events);
    const summary = events.map((e) => [
      e.cardId, e.type, e.clash?.attackerSide, e.clash?.defenderSide,
      e.clash?.attackerPower, e.clash?.defenderPower, e.clash?.outcome,
    ]);
    assert.deepEqual(summary, [
      ["up", EVENT_TYPES.CARD_FLIPPED, "top", "bottom", 5, 4, "win"],
      ["right", EVENT_TYPES.CARD_DEFENDED, "right", "left", 5, 5, "tie"],
      ["down", EVENT_TYPES.CARD_DEFENDED, "bottom", "top", 5, 6, "lose"],
      ["left", EVENT_TYPES.CARD_FLIPPED, "left", "right", 5, 3, "win"],
    ]);
    for (const e of events) assert.deepEqual(e.clash?.attacker, { x: 2, y: 2 });
    // Flip outcomes match actual ownership.
    assert.equal(board[1][2].card?.owner, "p1");
    assert.equal(board[2][3].card?.owner, "p2");
    assert.equal(board[3][2].card?.owner, "p2");
    assert.equal(board[2][1].card?.owner, "p1");
  } finally {
    simulationContext.exitSimulation();
  }
});

test("clash payload: prevented defeat reports 'prevented'", () => {
  simulationContext.enterSimulation();
  try {
    const board = createEmptyBoard();
    const locked = createTestCard({ id: "locked", owner: "p2", power: { top: 1, right: 1, bottom: 1, left: 1 } });
    locked.lockedTurns = 2;
    placeCardOnBoard(board, { x: 3, y: 2 }, locked);
    placeCardOnBoard(board, { x: 2, y: 2 }, createTestCard({ id: "atk", owner: "p1", power: { top: 5, right: 5, bottom: 5, left: 5 } }));
    const state = createTestGameState({ board, player1Id: "p1", player2Id: "p2" });

    const [e] = combatEvents(resolveCombat(state, { x: 2, y: 2 }, "p1").events);
    assert.equal(e.type, EVENT_TYPES.CARD_DEFENDED);
    assert.equal(e.clash?.outcome, "prevented");
    assert.equal(board[2][3].card?.owner, "p2");
  } finally {
    simulationContext.exitSimulation();
  }
});

test("ability (SPECIAL) flips carry no clash payload", () => {
  simulationContext.enterSimulation();
  try {
    const board = createEmptyBoard();
    const target = createTestCard({ id: "t", owner: "p2" });
    const source = createTestCard({ id: "s", owner: "p1" });
    placeCardOnBoard(board, { x: 3, y: 3 }, target);
    placeCardOnBoard(board, { x: 2, y: 2 }, source);
    const state = createTestGameState({ board, player1Id: "p1", player2Id: "p2" });

    const events = combatEvents(
      flipCard(state, { x: 3, y: 3 }, target, source, "ryujin-surge", {
        forcedOwnerId: "p1",
        combatType: COMBAT_TYPES.SPECIAL,
      }),
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].clash, undefined);
  } finally {
    simulationContext.exitSimulation();
  }
});
