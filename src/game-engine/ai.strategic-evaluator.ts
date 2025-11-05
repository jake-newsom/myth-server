import { GameState, BoardPosition } from "../types/game.types";
import { InGameCard, PowerValues } from "../types/card.types";
import { AI_CONFIG, GAME_CONFIG } from "../config/constants";
import {
  getAdjacentCards,
  getAlliesAdjacentTo,
  getEnemiesAdjacentTo,
  getAllAlliesOnBoard,
} from "./ability.utils";

/**
 * Evaluates strategic positioning and board control for AI decision making
 */
export class StrategicEvaluator {
  /**
   * Evaluates overall strategic value of a position
   */
  evaluateStrategicPosition(
    gameState: GameState,
    card: InGameCard,
    position: BoardPosition,
    aiPlayerId: string
  ): number {
    let score = 0;

    score += this.evaluatePositionalValue(position);
    score += this.evaluateBoardControl(gameState, position, aiPlayerId);
    score += this.evaluateDefensiveValue(gameState, card, position, aiPlayerId);
    score += this.evaluateOffensiveValue(gameState, card, position, aiPlayerId);
    score += this.evaluateTerritoryControl(gameState, position, aiPlayerId);

    return score;
  }

  /**
   * Evaluates intrinsic value of a position (corners, edges, center)
   */
  private evaluatePositionalValue(position: BoardPosition): number {
    let score = 0;
    const { x, y } = position;
    const maxIndex = GAME_CONFIG.BOARD_SIZE - 1;

    // Corner positions - strategic control
    if (
      (x === 0 && y === 0) ||
      (x === maxIndex && y === 0) ||
      (x === 0 && y === maxIndex) ||
      (x === maxIndex && y === maxIndex)
    ) {
      score += AI_CONFIG.MOVE_EVALUATION.CORNER_BONUS;
    }
    // Edge positions - moderate control
    else if (x === 0 || x === maxIndex || y === 0 || y === maxIndex) {
      score += AI_CONFIG.MOVE_EVALUATION.EDGE_BONUS;
    }
    // Center positions - flexible but exposed
    else if (x > 0 && x < maxIndex && y > 0 && y < maxIndex) {
      score += AI_CONFIG.MOVE_EVALUATION.CENTER_BONUS;
    }

    return score;
  }

  /**
   * Evaluates how this move affects board control
   */
  private evaluateBoardControl(
    gameState: GameState,
    position: BoardPosition,
    aiPlayerId: string
  ): number {
    let score = 0;
    const board = gameState.board;

    // Count adjacent positions we could influence
    const adjacentCards = getAdjacentCards(position, board);
    const adjacentAllies = getAlliesAdjacentTo(position, board, aiPlayerId);
    const adjacentEnemies = getEnemiesAdjacentTo(position, board, aiPlayerId);

    // More adjacent allies = stronger position
    score +=
      adjacentAllies.length * AI_CONFIG.MOVE_EVALUATION.BOARD_CONTROL_VALUE;

    // Being near enemies is good for offensive pressure
    score +=
      adjacentEnemies.length *
      (AI_CONFIG.MOVE_EVALUATION.BOARD_CONTROL_VALUE * 0.5);

    // Empty adjacent spaces = future flexibility
    const emptyAdjacent = this.countEmptyAdjacentSpaces(position, board);
    score +=
      emptyAdjacent * (AI_CONFIG.MOVE_EVALUATION.BOARD_CONTROL_VALUE * 0.3);

    return score;
  }

  /**
   * Evaluates defensive value (protecting important cards)
   */
  private evaluateDefensiveValue(
    gameState: GameState,
    card: InGameCard,
    position: BoardPosition,
    aiPlayerId: string
  ): number {
    let score = 0;
    const board = gameState.board;

    const adjacentAllies = getAlliesAdjacentTo(position, board, aiPlayerId);

    // Protect high-power allies
    for (const ally of adjacentAllies) {
      const allyPower = this.calculateTotalPower(ally.current_power);
      const cardPower = this.calculateTotalPower(card.current_power);

      // If we're stronger and protecting a valuable ally
      if (cardPower >= allyPower && allyPower > 20) {
        score += AI_CONFIG.MOVE_EVALUATION.DEFENSIVE_POSITION_BONUS;
      }

      // Extra value for protecting cards with powerful abilities
      if (ally.base_card_data.special_ability) {
        score += AI_CONFIG.MOVE_EVALUATION.DEFENSIVE_POSITION_BONUS * 0.5;
      }
    }

    // Defensive positioning against enemy threats
    const adjacentEnemies = getEnemiesAdjacentTo(position, board, aiPlayerId);
    const cardPower = this.calculateTotalPower(card.current_power);

    for (const enemy of adjacentEnemies) {
      const enemyPower = this.calculateTotalPower(enemy.current_power);

      // Block strong enemies
      if (cardPower > enemyPower) {
        score += AI_CONFIG.MOVE_EVALUATION.DEFENSIVE_POSITION_BONUS * 1.5;
      }
    }

    return score;
  }

  /**
   * Evaluates offensive value (pressure and flip potential)
   */
  private evaluateOffensiveValue(
    gameState: GameState,
    card: InGameCard,
    position: BoardPosition,
    aiPlayerId: string
  ): number {
    let score = 0;
    const board = gameState.board;

    const adjacentEnemies = getEnemiesAdjacentTo(position, board, aiPlayerId);
    const cardPower = this.calculateTotalPower(card.current_power);

    // Value based on enemies we can pressure or flip
    for (const enemy of adjacentEnemies) {
      const enemyPower = this.calculateTotalPower(enemy.current_power);

      // High value for flipping strong enemies
      if (cardPower > enemyPower) {
        const powerDifference = cardPower - enemyPower;
        score += AI_CONFIG.MOVE_EVALUATION.OFFENSIVE_POSITION_BONUS;

        // Bonus for flipping much stronger enemies
        if (powerDifference > 5) {
          score += AI_CONFIG.MOVE_EVALUATION.OFFENSIVE_POSITION_BONUS * 0.5;
        }
      }

      // Even if we can't flip, applying pressure is valuable
      else if (cardPower >= enemyPower * 0.8) {
        score += AI_CONFIG.MOVE_EVALUATION.OFFENSIVE_POSITION_BONUS * 0.3;
      }
    }

    return score;
  }

  /**
   * Evaluates territory control (regions of the board)
   */
  private evaluateTerritoryControl(
    gameState: GameState,
    position: BoardPosition,
    aiPlayerId: string
  ): number {
    let score = 0;
    const board = gameState.board;

    // Calculate influence in this quadrant
    const quadrant = this.getQuadrant(position);
    const controlInQuadrant = this.calculateQuadrantControl(
      gameState,
      quadrant,
      aiPlayerId
    );

    // Reward expanding into contested or enemy quadrants
    if (controlInQuadrant < 0) {
      // Enemy controlled - high value to contest
      score += AI_CONFIG.MOVE_EVALUATION.BOARD_CONTROL_VALUE * 1.5;
    } else if (controlInQuadrant === 0) {
      // Contested - good to establish presence
      score += AI_CONFIG.MOVE_EVALUATION.BOARD_CONTROL_VALUE;
    } else {
      // Already controlled - less urgent
      score += AI_CONFIG.MOVE_EVALUATION.BOARD_CONTROL_VALUE * 0.5;
    }

    return score;
  }

  /**
   * Calculates which quadrant a position is in (0-3)
   */
  private getQuadrant(position: BoardPosition): number {
    const midpoint = Math.floor(GAME_CONFIG.BOARD_SIZE / 2);
    const isRight = position.x >= midpoint;
    const isBottom = position.y >= midpoint;

    if (!isRight && !isBottom) return 0; // Top-left
    if (isRight && !isBottom) return 1; // Top-right
    if (!isRight && isBottom) return 2; // Bottom-left
    return 3; // Bottom-right
  }

  /**
   * Calculates control of a quadrant (-1 = enemy, 0 = contested, 1 = friendly)
   */
  private calculateQuadrantControl(
    gameState: GameState,
    quadrant: number,
    aiPlayerId: string
  ): number {
    const board = gameState.board;
    let friendlyCards = 0;
    let enemyCards = 0;

    const midpoint = Math.floor(GAME_CONFIG.BOARD_SIZE / 2);

    for (let y = 0; y < GAME_CONFIG.BOARD_SIZE; y++) {
      for (let x = 0; x < GAME_CONFIG.BOARD_SIZE; x++) {
        const pos = { x, y };
        if (this.getQuadrant(pos) === quadrant) {
          const cell = board[y][x];
          if (cell?.card) {
            if (cell.card.owner === aiPlayerId) {
              friendlyCards++;
            } else {
              enemyCards++;
            }
          }
        }
      }
    }

    if (friendlyCards > enemyCards) return 1;
    if (enemyCards > friendlyCards) return -1;
    return 0;
  }

  /**
   * Counts empty adjacent spaces
   */
  private countEmptyAdjacentSpaces(
    position: BoardPosition,
    board: GameState["board"]
  ): number {
    let count = 0;
    const directions = [
      { dx: 0, dy: -1 },
      { dx: 1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: -1, dy: 0 },
    ];

    for (const dir of directions) {
      const nx = position.x + dir.dx;
      const ny = position.y + dir.dy;

      if (
        nx >= 0 &&
        nx < GAME_CONFIG.BOARD_SIZE &&
        ny >= 0 &&
        ny < GAME_CONFIG.BOARD_SIZE
      ) {
        if (!board[ny][nx]?.card) {
          count++;
        }
      }
    }

    return count;
  }

  /**
   * Calculates total power of a card
   */
  private calculateTotalPower(power: PowerValues): number {
    return power.top + power.right + power.bottom + power.left;
  }

  /**
   * Evaluates if this is a critical blocking position
   */
  evaluateBlockingValue(
    gameState: GameState,
    position: BoardPosition,
    aiPlayerId: string
  ): number {
    let score = 0;
    const board = gameState.board;

    // Check if this position blocks enemy expansion
    const adjacentEnemies = getEnemiesAdjacentTo(position, board, aiPlayerId);

    if (adjacentEnemies.length >= 2) {
      // Blocking multiple enemies is very valuable
      score += AI_CONFIG.MOVE_EVALUATION.DEFENSIVE_POSITION_BONUS * 2;
    }

    return score;
  }

  /**
   * Evaluates future potential of a position
   */
  evaluateFuturePotential(
    gameState: GameState,
    position: BoardPosition,
    aiPlayerId: string
  ): number {
    let score = 0;
    const board = gameState.board;

    // Positions with more empty adjacent spaces have more future options
    const emptyAdjacent = this.countEmptyAdjacentSpaces(position, board);
    score += emptyAdjacent * 10;

    // Positions that open up new areas are valuable
    const allAllies = getAllAlliesOnBoard(board, aiPlayerId);
    if (allAllies.length > 0) {
      let minDistance = Infinity;

      // Find if this extends our reach
      for (const ally of allAllies) {
        const distance =
          Math.abs(position.x - (ally.user_card_instance_id.length % 4)) +
          Math.abs(position.y - (ally.user_card_instance_id.length % 4));
        minDistance = Math.min(minDistance, distance);
      }

      if (minDistance > 2) {
        // Expanding into new territory
        score += 15;
      }
    }

    return score;
  }
}
