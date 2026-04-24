import { InGameCard } from "../types/card.types";
import { BoardPosition, GameState, TileTerrain } from "../types/game.types";
import { getCardTotalPower } from "./ability.utils";

export type MetricMap = Record<string, number>;

function getAdjacentPositions(
  position: BoardPosition,
  boardSize: number
): BoardPosition[] {
  const deltas = [
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
  ];

  return deltas
    .map((delta) => ({ x: position.x + delta.x, y: position.y + delta.y }))
    .filter(
      (pos) =>
        pos.x >= 0 && pos.x < boardSize && pos.y >= 0 && pos.y < boardSize
    );
}

function getDiagonalPositions(
  position: BoardPosition,
  boardSize: number
): BoardPosition[] {
  const deltas = [
    { x: -1, y: -1 },
    { x: 1, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: 1 },
  ];

  return deltas
    .map((delta) => ({ x: position.x + delta.x, y: position.y + delta.y }))
    .filter(
      (pos) =>
        pos.x >= 0 && pos.x < boardSize && pos.y >= 0 && pos.y < boardSize
    );
}

function hasPositiveTemporaryEffects(card: InGameCard): boolean {
  return card.temporary_effects.some((effect) => {
    const total = Object.values(effect.power).reduce(
      (sum, val) => sum + (val ?? 0),
      0
    );
    return total > 0;
  });
}

function hasNegativeTemporaryEffects(card: InGameCard): boolean {
  return card.temporary_effects.some((effect) => {
    const total = Object.values(effect.power).reduce(
      (sum, val) => sum + (val ?? 0),
      0
    );
    return total < 0;
  });
}

function countEnemiesInRow(
  board: GameState["board"],
  row: number,
  aiPlayerId: string
): number {
  let count = 0;
  for (let x = 0; x < board.length; x++) {
    const card = board[row][x]?.card;
    if (card && card.owner !== aiPlayerId) count++;
  }
  return count;
}

function countAlliesInRow(
  board: GameState["board"],
  row: number,
  aiPlayerId: string
): number {
  let count = 0;
  for (let x = 0; x < board.length; x++) {
    const card = board[row][x]?.card;
    if (card && card.owner === aiPlayerId) count++;
  }
  return count;
}

function countEnemiesInColumn(
  board: GameState["board"],
  col: number,
  aiPlayerId: string
): number {
  let count = 0;
  for (let y = 0; y < board.length; y++) {
    const card = board[y][col]?.card;
    if (card && card.owner !== aiPlayerId) count++;
  }
  return count;
}

function countAlliesInColumn(
  board: GameState["board"],
  col: number,
  aiPlayerId: string
): number {
  let count = 0;
  for (let y = 0; y < board.length; y++) {
    const card = board[y][col]?.card;
    if (card && card.owner === aiPlayerId) count++;
  }
  return count;
}

function estimateSafePlacementScore(
  card: InGameCard,
  adjacentAllies: InGameCard[],
  adjacentEnemies: InGameCard[],
  position: BoardPosition,
  boardSize: number
): number {
  const cardPower = getCardTotalPower(card);
  const strongerEnemyCount = adjacentEnemies.filter(
    (enemy) => getCardTotalPower(enemy) > cardPower
  ).length;
  const weakerEnemyCount = adjacentEnemies.length - strongerEnemyCount;

  const isEdge =
    position.x === 0 ||
    position.x === boardSize - 1 ||
    position.y === 0 ||
    position.y === boardSize - 1;
  const isCorner =
    (position.x === 0 || position.x === boardSize - 1) &&
    (position.y === 0 || position.y === boardSize - 1);

  let score = 0;
  score += adjacentAllies.length * 10;
  score += weakerEnemyCount * 8;
  score -= strongerEnemyCount * 15;
  if (isCorner) score += 20;
  else if (isEdge) score += 10;

  return score;
}

export function buildAbilityRuleMetrics(
  gameState: GameState,
  card: InGameCard,
  position: BoardPosition,
  aiPlayerId: string
): MetricMap {
  const board = gameState.board;
  const boardSize = board.length;
  const flattened = board.flat();
  const occupiedCells = flattened.filter((cell) => !!cell.card);
  const totalCells = boardSize * boardSize;

  const aiCards = occupiedCells.filter((cell) => cell.card?.owner === aiPlayerId);
  const enemyCards = occupiedCells.filter(
    (cell) => cell.card && cell.card.owner !== aiPlayerId
  );

  const adjacentPositions = getAdjacentPositions(position, boardSize);
  const diagonalPositions = getDiagonalPositions(position, boardSize);
  const adjacentCards = adjacentPositions
    .map((pos) => board[pos.y][pos.x]?.card ?? null)
    .filter((item): item is InGameCard => !!item);
  const adjacentAllies = adjacentCards.filter((adj) => adj.owner === aiPlayerId);
  const adjacentEnemies = adjacentCards.filter((adj) => adj.owner !== aiPlayerId);
  const adjacentEmptyCount = adjacentPositions.length - adjacentCards.length;
  const diagonalEnemies = diagonalPositions
    .map((pos) => board[pos.y][pos.x]?.card ?? null)
    .filter((item): item is InGameCard => !!item && item.owner !== aiPlayerId);

  const playerOwnedOccupiedRatio =
    occupiedCells.length === 0 ? 0 : aiCards.length / occupiedCells.length;
  const enemyOwnedOccupiedRatio =
    occupiedCells.length === 0 ? 0 : enemyCards.length / occupiedCells.length;
  const turnsRemaining = totalCells - occupiedCells.length;

  const cardPower = getCardTotalPower(card);
  const diagonalKillCount = diagonalEnemies.filter(
    (enemy) => getCardTotalPower(enemy) < cardPower
  ).length;
  const adjacentWeakerEnemyCount = adjacentEnemies.filter(
    (enemy) => getCardTotalPower(enemy) < cardPower
  ).length;
  const adjacentBuffedEnemyCount = adjacentEnemies.filter((enemy) =>
    hasPositiveTemporaryEffects(enemy)
  ).length;
  const adjacentDebuffedEnemyCount = adjacentEnemies.filter((enemy) =>
    hasNegativeTemporaryEffects(enemy)
  ).length;
  const adjacentSeaAllyCount = adjacentAllies.filter((ally) =>
    ally.base_card_data.tags.includes("Sea")
  ).length;
  const adjacentValkyrieAllyCount = adjacentAllies.filter((ally) =>
    ally.base_card_data.tags.includes("Valkyrie")
  ).length;
  const adjacentThorCount = adjacentAllies.filter(
    (ally) => ally.base_card_data.name === "Thor"
  ).length;
  const adjacentGoddessCount = adjacentAllies.filter((ally) =>
    ally.base_card_data.tags.includes("Goddess")
  ).length;
  const strongestEnemyPower = enemyCards.reduce((max, cell) => {
    const power = cell.card ? getCardTotalPower(cell.card) : 0;
    return Math.max(max, power);
  }, 0);
  const weakestEnemyPower = enemyCards.reduce((min, cell) => {
    const power = cell.card ? getCardTotalPower(cell.card) : Infinity;
    return Math.min(min, power);
  }, Infinity);
  const aiStrongestPower = aiCards.reduce((max, cell) => {
    const power = cell.card ? getCardTotalPower(cell.card) : 0;
    return Math.max(max, power);
  }, 0);
  const aiWeakestPower = aiCards.reduce((min, cell) => {
    const power = cell.card ? getCardTotalPower(cell.card) : Infinity;
    return Math.min(min, power);
  }, Infinity);

  const allWaterTiles = flattened.filter(
    (cell) => cell.tile_effect?.terrain === TileTerrain.Ocean
  ).length;
  const allLavaTiles = flattened.filter(
    (cell) => cell.tile_effect?.terrain === TileTerrain.Lava
  ).length;
  const cardsOnWater = flattened.filter(
    (cell) => !!cell.card && cell.tile_effect?.terrain === TileTerrain.Ocean
  );
  const enemyOnWaterCount = cardsOnWater.filter(
    (cell) => cell.card?.owner !== aiPlayerId
  ).length;
  const allyOnWaterCount = cardsOnWater.filter(
    (cell) => cell.card?.owner === aiPlayerId
  ).length;

  const enemyBuffedCountBoard = enemyCards.filter(
    (cell) => cell.card && hasPositiveTemporaryEffects(cell.card)
  ).length;
  const allyBuffedCountBoard = aiCards.filter(
    (cell) => cell.card && hasPositiveTemporaryEffects(cell.card)
  ).length;
  const enemyDebuffedCountBoard = enemyCards.filter(
    (cell) => cell.card && hasNegativeTemporaryEffects(cell.card)
  ).length;
  const allyDebuffedCountBoard = aiCards.filter(
    (cell) => cell.card && hasNegativeTemporaryEffects(cell.card)
  ).length;

  const enemyBeastOrDragonCount = enemyCards.filter((cell) => {
    const tags = cell.card?.base_card_data.tags ?? [];
    return tags.includes("Beast") || tags.includes("Dragon");
  }).length;
  const enemyDragonCount = enemyCards.filter((cell) =>
    (cell.card?.base_card_data.tags ?? []).includes("Dragon")
  ).length;
  const enemyBeastCount = enemyCards.filter((cell) =>
    (cell.card?.base_card_data.tags ?? []).includes("Beast")
  ).length;
  const enemyDemonCount = enemyCards.filter((cell) =>
    (cell.card?.base_card_data.tags ?? []).includes("Demon")
  ).length;
  const enemyYokaiCount = enemyCards.filter((cell) =>
    (cell.card?.base_card_data.tags ?? []).includes("Yokai")
  ).length;
  const allDragonCount = occupiedCells.filter((cell) =>
    (cell.card?.base_card_data.tags ?? []).includes("Dragon")
  ).length;

  const aiPlayer =
    gameState.player1.user_id === aiPlayerId ? gameState.player1 : gameState.player2;
  const defeatedAllies = aiPlayer.discard_pile?.length ?? 0;
  const allyDefeatForecast = Math.max(0, adjacentEnemies.length - adjacentAllies.length);
  const handCards = aiPlayer.hand
    .map((id) => gameState.hydrated_card_data_cache?.[id] ?? null)
    .filter((item): item is InGameCard => !!item);
  const weakestHandPower = handCards.reduce((min, handCard) => {
    return Math.min(min, getCardTotalPower(handCard));
  }, Infinity);

  const rowEnemyCount = countEnemiesInRow(board, position.y, aiPlayerId);
  const rowAllyCount = countAlliesInRow(board, position.y, aiPlayerId);
  const columnEnemyCount = countEnemiesInColumn(board, position.x, aiPlayerId);
  const columnAllyCount = countAlliesInColumn(board, position.x, aiPlayerId);

  const safePlacementScore = estimateSafePlacementScore(
    card,
    adjacentAllies,
    adjacentEnemies,
    position,
    boardSize
  );
  const cardPowerTotal = getCardTotalPower(card);
  const cardBasePowerTotal =
    card.base_card_data.base_power.top +
    card.base_card_data.base_power.right +
    card.base_card_data.base_power.bottom +
    card.base_card_data.base_power.left;
  const currentCardPowerGain = cardPowerTotal - cardBasePowerTotal;
  const isEdgePlacement =
    position.x === 0 ||
    position.x === boardSize - 1 ||
    position.y === 0 ||
    position.y === boardSize - 1;
  const isCornerPlacement =
    (position.x === 0 || position.x === boardSize - 1) &&
    (position.y === 0 || position.y === boardSize - 1);
  const isCenterPlacement =
    position.x > 0 &&
    position.x < boardSize - 1 &&
    position.y > 0 &&
    position.y < boardSize - 1;
  const hasAdjacentEnemy = adjacentEnemies.length > 0;
  const hasAdjacentAlly = adjacentAllies.length > 0;
  const enemyLead = enemyCards.length - aiCards.length;

  const metrics: MetricMap = {
    enemyOwnedOccupiedRatio,
    playerOwnedOccupiedRatio,
    enemyOwnedCountMinusPlayerOwnedCount: enemyCards.length - aiCards.length,
    playerOwnedCountMinusEnemyOwnedCount: aiCards.length - enemyCards.length,
    turnsRemaining,
    enemyLead,
    isAhead: enemyLead < 0 ? 1 : 0,
    isBehind: enemyLead > 0 ? 1 : 0,
    adjacentEnemyCount: adjacentEnemies.length,
    adjacentEnemyClusterSize: adjacentEnemies.length,
    adjacentAllyCount: adjacentAllies.length,
    adjacentEmptyCount,
    hasAdjacentEnemy: hasAdjacentEnemy ? 1 : 0,
    hasAdjacentAlly: hasAdjacentAlly ? 1 : 0,
    adjacentBuffedEnemyCount,
    adjacentDebuffedEnemyCount,
    adjacentWeakerEnemyCount,
    adjacentSeaAllyCount,
    adjacentValkyrieAllyCount,
    adjacentThorCount,
    adjacentGoddessCount,
    diagonalKillCount,
    hasWaterSynergy: allWaterTiles > 0 ? 1 : 0,
    hasLavaSynergy: allLavaTiles > 0 ? 1 : 0,
    waterTileCount: allWaterTiles,
    lavaTileCount: allLavaTiles,
    cardsOnWaterCount: cardsOnWater.length,
    allyOnWaterCount,
    enemyOnWaterCount,
    allyDefeatForecast,
    defeatedAlliesCount: defeatedAllies,
    allyBuffedCountBoard,
    enemyBuffedCountBoard,
    allyDebuffedCountBoard,
    enemyDebuffedCountBoard,
    safePlacementScore,
    enemyStrongestPower: strongestEnemyPower,
    enemyWeakestPower: Number.isFinite(weakestEnemyPower) ? weakestEnemyPower : 0,
    aiStrongestPower,
    aiWeakestPower: Number.isFinite(aiWeakestPower) ? aiWeakestPower : 0,
    enemyPowerAdvantage: strongestEnemyPower - aiStrongestPower,
    enemyBeastOrDragonCount,
    enemyDragonCount,
    enemyBeastCount,
    enemyDemonCount,
    enemyYokaiCount,
    allDragonCount,
    rowEnemyCount,
    columnEnemyCount,
    rowOrColumnEnemyCount: rowEnemyCount + columnEnemyCount,
    rowAllyCount,
    columnAllyCount,
    isEdgePlacement: isEdgePlacement ? 1 : 0,
    isCornerPlacement: isCornerPlacement ? 1 : 0,
    isCenterPlacement: isCenterPlacement ? 1 : 0,
    cardPowerTotal,
    currentCardPowerGain,
    weakestHandPower: Number.isFinite(weakestHandPower) ? weakestHandPower : 0,
    handSize: aiPlayer.hand.length,
    lowHandSize: aiPlayer.hand.length <= 2 ? 1 : 0,
    highHandSize: aiPlayer.hand.length >= 4 ? 1 : 0,
  };

  return metrics;
}
