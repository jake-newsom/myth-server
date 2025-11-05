import { GameState, BoardPosition } from "../types/game.types";
import { InGameCard } from "../types/card.types";
import { AI_CONFIG, GAME_CONFIG } from "../config/constants";
import * as _ from "lodash";
import * as validators from "./game.validators";
import { GameLogic } from "./game.logic";

interface MoveEvaluation {
  cardInstanceId: string;
  position: BoardPosition;
  score: number;
  depth: number;
}

/**
 * Implements minimax-style lookahead for AI decision making
 */
export class LookaheadEngine {
  private startTime: number = 0;
  private maxTimeMs: number = AI_CONFIG.LOOKAHEAD.MAX_TIME_MS;
  private nodesEvaluated: number = 0;

  /**
   * Evaluates a move with lookahead to consider future consequences
   */
  async evaluateWithLookahead(
    gameState: GameState,
    cardInstanceId: string,
    position: BoardPosition,
    aiPlayerId: string,
    depth: number,
    baseScore: number,
    alpha: number = -Infinity,
    beta: number = Infinity
  ): Promise<number> {
    this.nodesEvaluated++;

    // Time check - if we're running out of time, return base score
    if (Date.now() - this.startTime > this.maxTimeMs) {
      return baseScore;
    }

    // Base case - no more lookahead
    if (depth === 0) {
      return baseScore;
    }

    // Simulate this move
    const simulatedState = await this.simulateMove(
      gameState,
      cardInstanceId,
      position,
      aiPlayerId
    );

    if (!simulatedState) {
      return baseScore; // Invalid move
    }

    // If game ended, return final score
    if (simulatedState.status !== "active") {
      return this.evaluateEndState(simulatedState, aiPlayerId);
    }

    // Get opponent's best response (minimax)
    const opponentId =
      simulatedState.player1.user_id === aiPlayerId
        ? simulatedState.player2.user_id
        : simulatedState.player1.user_id;

    const opponentBestScore = await this.getBestOpponentScore(
      simulatedState,
      opponentId,
      depth - 1,
      alpha,
      beta
    );

    // Our score is negatively impacted by opponent's best score
    const lookaheadScore = baseScore - opponentBestScore * 0.7;

    return lookaheadScore;
  }

  /**
   * Gets the best score the opponent could achieve
   */
  private async getBestOpponentScore(
    gameState: GameState,
    opponentId: string,
    depth: number,
    alpha: number,
    beta: number
  ): Promise<number> {
    if (Date.now() - this.startTime > this.maxTimeMs) {
      return 0;
    }

    const opponent =
      gameState.player1.user_id === opponentId
        ? gameState.player1
        : gameState.player2;

    let maxScore = -Infinity;

    // Sample opponent's possible moves (limit for performance)
    const sampleSize = Math.min(opponent.hand.length * 3, 12); // Sample up to 12 moves
    let moveCount = 0;

    for (const instanceId of opponent.hand) {
      if (Date.now() - this.startTime > this.maxTimeMs) {
        break;
      }

      const cardData = gameState.hydrated_card_data_cache?.[instanceId];
      if (!cardData) continue;

      // Try a few key positions (corners, edges, adjacent to existing cards)
      const positions = this.getKeyPositions(gameState);

      for (const pos of positions) {
        if (moveCount >= sampleSize) break;

        const canPlace = validators.canPlaceOnTile(gameState, pos);
        if (!canPlace.canPlace) continue;

        // Quick score estimation for opponent move
        const quickScore = this.quickEvaluateMove(
          gameState,
          cardData,
          pos,
          opponentId
        );

        maxScore = Math.max(maxScore, quickScore);

        // Alpha-beta pruning
        if (maxScore >= beta) {
          return maxScore; // Beta cutoff
        }
        alpha = Math.max(alpha, maxScore);

        moveCount++;
      }
    }

    return maxScore === -Infinity ? 0 : maxScore;
  }

  /**
   * Quick evaluation without full simulation (for performance)
   */
  private quickEvaluateMove(
    gameState: GameState,
    card: InGameCard,
    position: BoardPosition,
    playerId: string
  ): number {
    let score = 0;

    // Quick flip count
    const directions = [
      { dx: 0, dy: -1, from: "bottom", to: "top" },
      { dx: 1, dy: 0, from: "left", to: "right" },
      { dx: 0, dy: 1, from: "top", to: "bottom" },
      { dx: -1, dy: 0, from: "right", to: "left" },
    ];

    let flips = 0;
    for (const dir of directions) {
      const nx = position.x + dir.dx;
      const ny = position.y + dir.dy;

      if (
        nx >= 0 &&
        nx < GAME_CONFIG.BOARD_SIZE &&
        ny >= 0 &&
        ny < GAME_CONFIG.BOARD_SIZE
      ) {
        const cell = gameState.board[ny][nx];
        if (cell?.card && cell.card.owner !== playerId) {
          const placedPower = (card.current_power as any)[dir.from];
          const adjacentPower = (cell.card.current_power as any)[dir.to];
          if (placedPower > adjacentPower) {
            flips++;
          }
        }
      }
    }

    score += flips * 100;
    score +=
      card.current_power.top +
      card.current_power.right +
      card.current_power.bottom +
      card.current_power.left;

    return score;
  }

  /**
   * Simulates a move and returns the resulting game state
   */
  private async simulateMove(
    gameState: GameState,
    cardInstanceId: string,
    position: BoardPosition,
    playerId: string
  ): Promise<GameState | null> {
    try {
      const clonedState = _.cloneDeep(gameState);

      // Use GameLogic to simulate the move
      const result = await GameLogic.placeCard(
        clonedState,
        playerId,
        cardInstanceId,
        position
      );

      return result.state;
    } catch (error) {
      // Invalid move
      return null;
    }
  }

  /**
   * Evaluates end game state
   */
  private evaluateEndState(gameState: GameState, aiPlayerId: string): number {
    if (gameState.winner === aiPlayerId) {
      return 10000; // Winning is highest value
    } else if (gameState.winner === null) {
      return 0; // Draw
    } else {
      return -10000; // Losing is worst
    }
  }

  /**
   * Gets key positions to evaluate (for performance optimization)
   */
  private getKeyPositions(gameState: GameState): BoardPosition[] {
    const positions: BoardPosition[] = [];
    const board = gameState.board;

    // Add all empty positions adjacent to existing cards
    for (let y = 0; y < GAME_CONFIG.BOARD_SIZE; y++) {
      for (let x = 0; x < GAME_CONFIG.BOARD_SIZE; x++) {
        const cell = board[y][x];
        if (cell?.card) {
          // Add adjacent empty positions
          const directions = [
            { dx: 0, dy: -1 },
            { dx: 1, dy: 0 },
            { dx: 0, dy: 1 },
            { dx: -1, dy: 0 },
          ];

          for (const dir of directions) {
            const nx = x + dir.dx;
            const ny = y + dir.dy;

            if (
              nx >= 0 &&
              nx < GAME_CONFIG.BOARD_SIZE &&
              ny >= 0 &&
              ny < GAME_CONFIG.BOARD_SIZE
            ) {
              if (!board[ny][nx]?.card) {
                positions.push({ x: nx, y: ny });
              }
            }
          }
        }
      }
    }

    // If no cards on board, start with corners and center
    if (positions.length === 0) {
      positions.push({ x: 0, y: 0 });
      positions.push({ x: 3, y: 0 });
      positions.push({ x: 0, y: 3 });
      positions.push({ x: 3, y: 3 });
      positions.push({ x: 1, y: 1 });
      positions.push({ x: 2, y: 2 });
    }

    // Remove duplicates
    const unique = positions.filter(
      (pos, index, self) =>
        index === self.findIndex((p) => p.x === pos.x && p.y === pos.y)
    );

    return unique;
  }

  /**
   * Starts timing for lookahead evaluation
   */
  startTiming(): void {
    this.startTime = Date.now();
    this.nodesEvaluated = 0;
  }

  /**
   * Gets statistics about the lookahead evaluation
   */
  getStats(): { nodesEvaluated: number; timeMs: number } {
    return {
      nodesEvaluated: this.nodesEvaluated,
      timeMs: Date.now() - this.startTime,
    };
  }
}
