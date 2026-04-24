import test from "node:test";
import assert from "node:assert/strict";
import { AbilityAnalyzer } from "../ai.ability-analyzer";
import { AbilityRuleEngine } from "../ai.rules.engine";
import { StrategicEvaluator } from "../ai.strategic-evaluator";
import { UnifiedScoreV2 } from "../ai.unified-score";
import {
  createEmptyBoard,
  createTestCard,
  createTestGameState,
  placeCardOnBoard,
} from "./ai.test-utils";

test("UnifiedScoreV2 rewards immediate flips and board control", () => {
  const board = createEmptyBoard();
  const enemy = createTestCard({
    id: "enemy",
    owner: "enemy",
    power: { top: 2, right: 2, bottom: 2, left: 2 },
  });
  placeCardOnBoard(board, { x: 1, y: 1 }, enemy);

  const attackingCard = createTestCard({
    id: "attacker",
    owner: "ai",
    abilityId: "surtr_flames",
    power: { top: 6, right: 6, bottom: 6, left: 6 },
  });

  const gameState = createTestGameState({
    board,
    player1Id: "ai",
    player2Id: "enemy",
  });

  const scorer = new UnifiedScoreV2(
    new AbilityAnalyzer(),
    new StrategicEvaluator(),
    new AbilityRuleEngine()
  );

  const score = scorer.scoreMove(gameState, attackingCard, { x: 1, y: 2 }, "ai");

  assert.ok(score.immediate_flips > 0);
  assert.ok(score.board_control > 0);
  assert.ok(score.total > 0);
});

test("UnifiedScoreV2 applies risk to dangerous placements", () => {
  const board = createEmptyBoard();
  const enemyA = createTestCard({
    id: "enemy-a",
    owner: "enemy",
    power: { top: 8, right: 8, bottom: 8, left: 8 },
  });
  const enemyB = createTestCard({
    id: "enemy-b",
    owner: "enemy",
    power: { top: 8, right: 8, bottom: 8, left: 8 },
  });
  placeCardOnBoard(board, { x: 1, y: 1 }, enemyA);
  placeCardOnBoard(board, { x: 2, y: 2 }, enemyB);

  const fragileCard = createTestCard({
    id: "fragile",
    owner: "ai",
    abilityId: "loki_flip",
    power: { top: 2, right: 2, bottom: 2, left: 2 },
  });
  const gameState = createTestGameState({ board, player1Id: "ai", player2Id: "enemy" });

  const scorer = new UnifiedScoreV2(
    new AbilityAnalyzer(),
    new StrategicEvaluator(),
    new AbilityRuleEngine()
  );

  const score = scorer.scoreMove(gameState, fragileCard, { x: 2, y: 1 }, "ai");
  assert.ok(score.risk > 0);
});
