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
  const board = createEmptyBoard();
  const enemyA = createTestCard({ id: "e1", owner: "enemy" });
  const enemyB = createTestCard({ id: "e2", owner: "enemy" });
  const ally = createTestCard({ id: "a1", owner: "ai" });
  placeCardOnBoard(board, { x: 0, y: 0 }, enemyA);
  placeCardOnBoard(board, { x: 1, y: 0 }, enemyB);
  placeCardOnBoard(board, { x: 0, y: 1 }, ally);

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
    position: { x: 2, y: 2 },
    aiPlayerId: "ai",
  });

  assert.equal(result.ruleMatched, true);
  assert.ok(result.totalScore > 0);
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
