import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EVENT_TYPES } from "../../src/types/game-engine.types";
import { applySlayerOnDefeat } from "../../src/game-engine/sagaBattle.mechanics";
import {
  createTestCard,
  createEmptyBoard,
  createTestGameState,
  placeCardOnBoard,
} from "../../src/game-engine/__tests__/ai.test-utils";

describe("applySlayerOnDefeat", () => {
  it("reduces the defeated enemy's highest side by 1 and adds 1 to the slayer card's lowest side immediately", () => {
    const board = createEmptyBoard();

    const slayerCard = createTestCard({
      id: "saga-slayer-card",
      owner: "p1",
      power: { top: 9, right: 9, bottom: 5, left: 9 },
    });
    slayerCard.saga_rune_type = "slayer";
    slayerCard.saga_card_id = "slayer-card";

    const enemyCard = createTestCard({
      id: "enemy-card",
      owner: "p2",
      power: { top: 2, right: 7, bottom: 3, left: 1 },
    });

    placeCardOnBoard(board, { x: 0, y: 0 }, slayerCard);
    placeCardOnBoard(board, { x: 0, y: 1 }, enemyCard);

    const state = createTestGameState({ board, player1Id: "p1", player2Id: "p2" });
    state.saga_context = {
      run_id: "run-1",
      node_id: "node-1",
      season_id: "season-1",
      floor: 1,
      floor_difficulty: "normal",
      battle_difficulty: "easy",
      enemy_stat_bonus: 0,
      ai_profile: "basic",
      worlds_end: { defeats_per_destroy: 1, defeats_since_destroy: 0 },
    } as any;

    const flips = [
      {
        type: EVENT_TYPES.CARD_FLIPPED,
        eventId: "flip-1",
        timestamp: Date.now(),
        cardId: "enemy-card",
        sourceCardId: "saga-slayer-card",
        sourcePlayerId: "p1",
        position: { x: 0, y: 1 },
      } as any,
    ];

    const { state: after, events } = applySlayerOnDefeat(state, flips, "p1");

    // Enemy's highest side was "right" (7) -> should drop to 6.
    const enemyAfter = after.board[1][0]!.card!;
    assert.equal(enemyAfter.current_power.right, 6);
    assert.equal(enemyAfter.current_power.top, 2);
    assert.equal(enemyAfter.current_power.bottom, 3);
    assert.equal(enemyAfter.current_power.left, 1);

    // Slayer's lowest side was "bottom" (5) -> should rise to 6.
    const slayerAfter = after.board[0][0]!.card!;
    assert.equal(slayerAfter.current_power.bottom, 6);
    assert.equal(slayerAfter.current_power.top, 9);
    assert.equal(slayerAfter.current_power.right, 9);
    assert.equal(slayerAfter.current_power.left, 9);

    // Pending steal tracked for battle-end permanent persistence.
    assert.deepEqual(after.saga_context?.slayer_pending_steals, { "slayer-card": 1 });

    // Both changes surfaced as power-changed events.
    const powerEvents = events.filter((e) => e.type === EVENT_TYPES.CARD_POWER_CHANGED);
    assert.equal(powerEvents.length, 2);
    assert.deepEqual(
      powerEvents.map((e: any) => e.powerDelta).sort(),
      [-1, 1]
    );
  });

  it("does not reduce a side that is already at 0", () => {
    const board = createEmptyBoard();

    const slayerCard = createTestCard({
      id: "saga-slayer-card",
      owner: "p1",
      power: { top: 9, right: 9, bottom: 9, left: 9 },
    });
    slayerCard.saga_rune_type = "slayer";
    slayerCard.saga_card_id = "slayer-card";

    const enemyCard = createTestCard({
      id: "enemy-card",
      owner: "p2",
      power: { top: 0, right: 0, bottom: 0, left: 0 },
    });

    placeCardOnBoard(board, { x: 0, y: 0 }, slayerCard);
    placeCardOnBoard(board, { x: 0, y: 1 }, enemyCard);

    const state = createTestGameState({ board, player1Id: "p1", player2Id: "p2" });
    state.saga_context = {
      run_id: "run-1",
      node_id: "node-1",
      season_id: "season-1",
      floor: 1,
      floor_difficulty: "normal",
      battle_difficulty: "easy",
      enemy_stat_bonus: 0,
      ai_profile: "basic",
      worlds_end: { defeats_per_destroy: 1, defeats_since_destroy: 0 },
    } as any;

    const flips = [
      {
        type: EVENT_TYPES.CARD_FLIPPED,
        eventId: "flip-1",
        timestamp: Date.now(),
        cardId: "enemy-card",
        sourceCardId: "saga-slayer-card",
        sourcePlayerId: "p1",
        position: { x: 0, y: 1 },
      } as any,
    ];

    const { state: after, events } = applySlayerOnDefeat(state, flips, "p1");

    const enemyAfter = after.board[1][0]!.card!;
    assert.deepEqual(enemyAfter.current_power, { top: 0, right: 0, bottom: 0, left: 0 });

    const slayerAfter = after.board[0][0]!.card!;
    // top is first in tie-break order, so it should be the one incremented.
    assert.equal(slayerAfter.current_power.top, 10);

    const powerEvents = events.filter((e) => e.type === EVENT_TYPES.CARD_POWER_CHANGED);
    assert.equal(powerEvents.length, 1);
    assert.equal((powerEvents[0] as any).powerDelta, 1);
  });
});
