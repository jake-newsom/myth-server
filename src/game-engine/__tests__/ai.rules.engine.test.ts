import test from "node:test";
import assert from "node:assert/strict";
import { AbilityRuleEngine } from "../ai.rules.engine";
import {
  createEmptyBoard,
  createTestCard,
  createTestGameState,
  placeCardOnBoard,
} from "./ai.test-utils";

test("Loki receives positive score when behind on occupied board control", () => {
  // Loki is tuned as a late-game desperation play: the rule actively suppresses
  // it early (totalCardsOnBoard <= 6) and when not significantly behind on card
  // count (enemyOwnedCountMinusPlayerOwnedCount <= 1). So the scenario must be a
  // genuine late-game board where the AI is clearly behind for Loki to be a good
  // play. Fill 13 of 16 cells: 9 enemy, 4 ai, leaving (3,3),(2,3),(3,2) open.
  const board = createEmptyBoard();
  const open = new Set(["3,3", "2,3", "3,2"]);
  let enemyPlaced = 0;
  let aiPlaced = 0;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      if (open.has(`${x},${y}`)) continue;
      // 9 enemy, 4 ai (enemy leads by 5, owns ~0.69 of the board).
      const owner = enemyPlaced < 9 ? "enemy" : "ai";
      if (owner === "enemy") enemyPlaced++;
      else aiPlaced++;
      placeCardOnBoard(
        board,
        { x, y },
        createTestCard({ id: `${owner}-${x}-${y}`, owner })
      );
    }
  }
  assert.equal(enemyPlaced, 9);
  assert.equal(aiPlaced, 4);

  const loki = createTestCard({
    id: "loki",
    owner: "ai",
    abilityId: "loki_flip",
  });
  const gameState = createTestGameState({ board, player1Id: "ai", player2Id: "enemy" });

  const engine = new AbilityRuleEngine();
  const result = engine.evaluate({
    gameState,
    card: loki,
    position: { x: 3, y: 3 },
    aiPlayerId: "ai",
  });

  assert.equal(result.ruleMatched, true);
  assert.ok(
    result.totalScore > 0,
    `Loki should score positive when genuinely behind late-game, got ${result.totalScore}`
  );
});

test("Fenrir is penalized when no adjacent weaker enemy exists", () => {
  const board = createEmptyBoard();
  const strongEnemy = createTestCard({
    id: "strong-enemy",
    owner: "enemy",
    power: { top: 8, right: 8, bottom: 8, left: 8 },
  });
  placeCardOnBoard(board, { x: 1, y: 1 }, strongEnemy);

  const fenrir = createTestCard({
    id: "fenrir",
    owner: "ai",
    abilityId: "fenrir_devourer_surge",
    power: { top: 4, right: 4, bottom: 4, left: 4 },
  });
  const gameState = createTestGameState({ board, player1Id: "ai", player2Id: "enemy" });

  const engine = new AbilityRuleEngine();
  const result = engine.evaluate({
    gameState,
    card: fenrir,
    position: { x: 1, y: 2 },
    aiPlayerId: "ai",
  });

  assert.equal(result.ruleMatched, true);
  assert.ok(result.totalScore < 0);
});
