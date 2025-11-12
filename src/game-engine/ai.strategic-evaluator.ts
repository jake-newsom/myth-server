import { GameState, BoardPosition, TileTerrain } from "../types/game.types";
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
    score += this.evaluateAbilityPositionRequirements(gameState, card, position, aiPlayerId);

    return score;
  }

  /**
   * Evaluates if the position meets ability-specific requirements
   * Returns large positive bonus if requirements met, large penalty if not met but required
   */
  evaluateAbilityPositionRequirements(
    gameState: GameState,
    card: InGameCard,
    position: BoardPosition,
    aiPlayerId: string
  ): number {
    if (!card.base_card_data.special_ability) {
      return 0;
    }

    const abilityName = card.base_card_data.special_ability.name;
    const board = gameState.board;
    let score = 0;

    const { x, y } = position;
    const maxIndex = GAME_CONFIG.BOARD_SIZE - 1;
    const isEdge = x === 0 || x === maxIndex || y === 0 || y === maxIndex;
    const isCorner = (x === 0 || x === maxIndex) && (y === 0 || y === maxIndex);
    const isCenter = x > 0 && x < maxIndex && y > 0 && y < maxIndex;

    const adjacentCards = getAdjacentCards(position, board);
    const adjacentAllies = getAlliesAdjacentTo(position, board, aiPlayerId);
    const adjacentEnemies = getEnemiesAdjacentTo(position, board, aiPlayerId);

    // === EDGE REQUIREMENTS ===
    if (abilityName === "Shore Fury") {
      // MUST be on edge for +2 bonus
      if (isEdge) {
        score += 200; // Huge bonus - requirement met
      } else {
        score -= 300; // Massive penalty - ability won't work
      }
    }

    // === ISOLATION REQUIREMENTS ===
    else if (abilityName === "Primordial Force") {
      // +2 to all if NO adjacent cards
      if (adjacentCards.length === 0) {
        score += 180; // Huge bonus
      } else {
        score -= 100; // Penalty for each adjacent card
        score -= adjacentCards.length * 50;
      }
    } else if (abilityName === "Peaceful Strength") {
      // +2 if no adjacent enemies
      if (adjacentEnemies.length === 0) {
        score += 120;
      } else {
        score -= 80; // Penalty if adjacent to enemies
      }
    }

    // === ADJACENCY REQUIREMENTS (Tribal/Synergy) ===
    else if (abilityName === "Sea's Protection") {
      // +3 if adjacent to Sea card
      const hasSeaAdjacent = adjacentAllies.some((c) => c.base_card_data.tags.includes("Sea"));
      if (hasSeaAdjacent) {
        score += 150; // Strong bonus
      } else {
        score -= 60; // Penalty if condition not met
      }
    } else if (abilityName === "Valkyrie Sisterhood") {
      // +2 if adjacent to Valkyrie
      const hasValkyrieAdjacent = adjacentAllies.some((c) => c.base_card_data.tags.includes("Valkyrie"));
      if (hasValkyrieAdjacent) {
        score += 130;
      } else {
        score -= 50;
      }
    } else if (abilityName === "Worthy Opponent") {
      // +1 to all if adjacent to Thor
      const hasThorAdjacent = adjacentAllies.some((c) => c.base_card_data.name === "Thor");
      if (hasThorAdjacent) {
        score += 120;
      } else {
        score -= 40;
      }
    } else if (abilityName === "Bride Demand") {
      // +3 Right if adjacent to Goddess (should be to the LEFT of Goddess)
      const hasGoddessAdjacent = adjacentAllies.some((c) => c.base_card_data.tags.includes("Goddess"));
      if (hasGoddessAdjacent) {
        score += 140;
      } else {
        score -= 50;
      }
    }

    // === TERRAIN REQUIREMENTS ===
    else if (abilityName === "Sacred Spring") {
      // MUST be on water/ocean tile
      const tile = board[y][x];
      const isWaterTile = tile?.tile_effect?.terrain === TileTerrain.Ocean;
      if (isWaterTile) {
        score += 250; // Essential requirement
      } else {
        score -= 400; // Huge penalty - ability won't work at all
      }
    }

    // === CENTRAL POSITIONING FOR RECURRING EFFECTS ===
    else if (
      abilityName === "Warrior's Aura" ||
      abilityName === "Vengeful Bite" ||
      abilityName === "Devourer's Surge" ||
      abilityName === "Moon's Balance"
    ) {
      // Recurring effects benefit from central, protected positions
      if (isCenter) {
        score += 80; // Central for max effect
      } else if (isCorner) {
        score += 40; // Corner for safety
      }
      // These need to survive multiple rounds
      if (adjacentAllies.length >= 2) {
        score += 60; // Protected by allies
      }
    }

    // === MULTI-TARGET POSITIONING ===
    else if (
      abilityName === "Flames of Muspelheim" ||
      abilityName === "Bone Chill" ||
      abilityName === "Icy Presence" ||
      abilityName === "Web Curse" ||
      abilityName === "Hex Field"
    ) {
      // These abilities affect adjacent cards/tiles - maximize adjacency
      if (isCenter) {
        score += 100; // Can affect 4 adjacents
      } else if (!isCorner) {
        score += 50; // Edge: 3 adjacents
      }
      // Bonus for each enemy adjacent (for offensive abilities)
      if (abilityName === "Flames of Muspelheim" || abilityName === "Bone Chill" || abilityName === "Icy Presence") {
        score += adjacentEnemies.length * 40;
      }
    }

    // === ALLY-BUFF POSITIONING ===
    else if (
      abilityName === "Mother's Blessing" ||
      abilityName === "Battle Cry" ||
      abilityName === "Poet's Rhythm" ||
      abilityName === "Warrior's Blessing" ||
      abilityName === "Allies Rally"
    ) {
      // These buff adjacent allies - place next to many allies
      if (adjacentAllies.length >= 3) {
        score += 150; // Optimal: 3+ allies
      } else if (adjacentAllies.length === 2) {
        score += 80; // Good: 2 allies
      } else if (adjacentAllies.length === 1) {
        score += 30; // OK: 1 ally
      } else {
        score -= 60; // Bad: no allies to buff
      }
    }

    // === ENEMY-ADJACENT POSITIONING ===
    else if (abilityName === "Steadfast Guard" || abilityName === "Beast Friend") {
      // These get stronger with adjacent enemies
      if (adjacentEnemies.length >= 3) {
        score += 140;
      } else if (adjacentEnemies.length === 2) {
        score += 80;
      } else if (adjacentEnemies.length === 1) {
        score += 30;
      } else {
        score -= 50; // Wasted potential
      }
    }

    // === DEFENSIVE ANCHOR POSITIONING (Invincibility) ===
    else if (
      abilityName === "Titan Shell" ||
      abilityName === "Light Undimmed" ||
      abilityName === "Ocean's Shield"
    ) {
      // These are defensive anchors - center or strategic points
      if (isCenter) {
        score += 140; // Lock down center
      } else if (x === 1 || x === 2 || y === 1 || y === 2) {
        score += 80; // Near-center positions
      }
    }

    // === ROW/COLUMN EFFECT POSITIONING ===
    else if (abilityName === "Frost Row" || abilityName === "Piercing Shot" || abilityName === "Many Heads") {
      // These affect entire rows/columns - position where most enemies are
      const enemiesInRow = this.countEnemiesInRow(gameState, y, aiPlayerId);
      const enemiesInColumn = this.countEnemiesInColumn(gameState, x, aiPlayerId);
      
      if (abilityName === "Frost Row") {
        score += enemiesInRow * 50;
      } else if (abilityName === "Piercing Shot") {
        score += enemiesInColumn * 50;
      } else if (abilityName === "Many Heads") {
        score += (enemiesInRow + enemiesInColumn) * 30;
      }
    }

    return score;
  }

  /**
   * Counts enemies in a specific row
   */
  private countEnemiesInRow(gameState: GameState, row: number, aiPlayerId: string): number {
    let count = 0;
    for (let x = 0; x < GAME_CONFIG.BOARD_SIZE; x++) {
      const cell = gameState.board[row][x];
      if (cell?.card && cell.card.owner !== aiPlayerId) {
        count++;
      }
    }
    return count;
  }

  /**
   * Counts enemies in a specific column
   */
  private countEnemiesInColumn(gameState: GameState, column: number, aiPlayerId: string): number {
    let count = 0;
    for (let y = 0; y < GAME_CONFIG.BOARD_SIZE; y++) {
      const cell = gameState.board[y][column];
      if (cell?.card && cell.card.owner !== aiPlayerId) {
        count++;
      }
    }
    return count;
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
