import test from "node:test";
import assert from "node:assert/strict";
import { GameLogic } from "../game.logic";
import { simulationContext } from "../simulation.context";
import {
  createEmptyBoard,
  createTestCard,
  createTestGameState,
  placeCardOnBoard,
} from "./ai.test-utils";

test("norse deck effect buffs a hand card at the start of turn when behind", async () => {
  simulationContext.enterSimulation();
  try {
    const board = createEmptyBoard();
    const opponentCard = createTestCard({ id: "p1-board", owner: "p1" });
    placeCardOnBoard(board, { x: 0, y: 0 }, opponentCard);

    const handCard = createTestCard({ id: "p2-hand", owner: "p2" });
    const state = createTestGameState({
      board,
      player1Id: "p1",
      player2Id: "p2",
      player2Hand: ["p2-hand"],
      hydrated: { "p2-hand": handCard },
    });

    state.current_player_id = "p1";
    state.player2.deck_effect = "norse";

    const result = await GameLogic.endTurn(state, "p1");
    const updatedCard = result.state.hydrated_card_data_cache?.["p2-hand"];

    assert.equal(updatedCard?.temporary_effects.length, 1);
    assert.equal(updatedCard?.temporary_effects[0]?.name, "Fated Resolve");
    assert.deepEqual(updatedCard?.current_power, {
      top: 5,
      right: 5,
      bottom: 5,
      left: 5,
    });
    assert.ok(
      result.events.some(
        (event) =>
          "effectName" in event &&
          event.effectName === "Fated Resolve" &&
          "cardId" in event &&
          event.cardId === "p2-hand"
      )
    );
  } finally {
    simulationContext.exitSimulation();
  }
});

test("norse deck effect does not buff the played card during placeCard", async () => {
  simulationContext.enterSimulation();
  try {
    const board = createEmptyBoard();
    const opponentCard = createTestCard({ id: "p1-board", owner: "p1" });
    placeCardOnBoard(board, { x: 1, y: 1 }, opponentCard);

    const playedCard = createTestCard({ id: "p2-play", owner: "p2" });
    const state = createTestGameState({
      board,
      player1Id: "p1",
      player2Id: "p2",
      player2Hand: ["p2-play"],
      hydrated: { "p2-play": playedCard },
    });

    state.current_player_id = "p2";
    state.player2.deck_effect = "norse";

    const result = await GameLogic.placeCard(state, "p2", "p2-play", { x: 0, y: 0 });
    const placedCard = result.state.board[0][0].card;

    assert.ok(placedCard);
    assert.equal(placedCard?.temporary_effects.length, 0);
    assert.equal(
      result.events.some(
        (event) => "effectName" in event && event.effectName === "Fated Resolve"
      ),
      false
    );
  } finally {
    simulationContext.exitSimulation();
  }
});
