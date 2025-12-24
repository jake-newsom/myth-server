import {
  EffectType,
  InGameCard,
  PowerValues,
  TemporaryEffect,
} from "../types/card.types";
import {
  BoardCell,
  BoardPosition,
  GameBoard,
  GameState,
  TileEffect,
  TileStatus,
} from "../types/game.types";
import { simulationContext } from "./simulation.context";
import {
  BaseGameEvent,
  CardEvent,
  EVENT_TYPES,
  TileEvent,
} from "./game-events";

import { v4 as uuidv4 } from "uuid";
import DailyTaskService from "../services/dailyTask.service";

/**
 * Helper function to get the tile effect that should be applied to a card at a specific position
 */
export function getTileEffectForPosition(
  gameState: GameState,
  position: BoardPosition
): TileEffect | undefined {
  return gameState.board[position.y]?.[position.x]?.tile_effect;
}

/**
 * Transfers tile effect power bonuses to a card as temporary effects
 * Returns true if a transfer occurred, false otherwise
 */
export function transferTileEffectToCard(
  card: InGameCard,
  tileEffect: TileEffect | undefined
): boolean {
  if (!tileEffect?.power) return false;

  if (tileEffect.applies_to_user && tileEffect.applies_to_user !== card.owner)
    return false;

  const temporaryEffect = {
    type: EffectType.TilePowerBonus,
    power: { ...tileEffect.power },
    duration: tileEffect.effect_duration ?? 1000,
    name: tileEffect.animation_label,
    data: {
      animation: tileEffect.animation_label,
      terrain: tileEffect.terrain,
      originalTileEffect: tileEffect.animation_label,
    },
  };

  card.temporary_effects.push(temporaryEffect);

  //TODO: Return a game event
  return true;
}

export function updateCurrentPower(card: InGameCard): PowerValues {
  const currentPower: PowerValues = structuredClone(
    card.base_card_data.base_power
  );

  // Add enhancements
  (Object.keys(card.power_enhancements) as (keyof PowerValues)[]).forEach(
    (direction) => {
      currentPower[direction] += card.power_enhancements[direction];
    }
  );

  // Add temporary effects
  if (card.temporary_effects) {
    card.temporary_effects.forEach((effect) => {
      (Object.keys(effect.power) as (keyof PowerValues)[]).forEach(
        (direction) => {
          currentPower[direction] += effect.power[direction] ?? 0;
        }
      );
    });
  }

  return {
    top: Math.max(currentPower.top, 0),
    bottom: Math.max(currentPower.bottom, 0),
    left: Math.max(currentPower.left, 0),
    right: Math.max(currentPower.right, 0),
  };
}

export function getOpponentId(playerId: string, gameState: GameState): string {
  return playerId === gameState.player1.user_id
    ? gameState.player2.user_id
    : gameState.player1.user_id;
}

export function buff(
  card: InGameCard,
  amount: number | PowerValues,
  name?: string,
  data?: Record<string, any>
): BaseGameEvent {
  return addTempBuff(card, 1000, amount, name, data);
}

export function debuff(
  card: InGameCard,
  amount: number | PowerValues,
  name?: string,
  data?: Record<string, any>
): BaseGameEvent {
  return addTempDebuff(card, 1000, amount, { name, data });
}

export function addTempBuff(
  card: InGameCard,
  duration: number,
  power: number | Partial<PowerValues>,
  name?: string,
  data?: Record<string, any>
): BaseGameEvent {
  if (!card.temporary_effects) {
    card.temporary_effects = [];
  }

  const buff =
    typeof power === "number"
      ? {
          top: power,
          bottom: power,
          left: power,
          right: power,
        }
      : power;

  card.temporary_effects.push({
    power: buff,
    duration,
    name,
    data,
    type: EffectType.Buff,
  });

  return {
    type: EVENT_TYPES.CARD_POWER_CHANGED,
    animation: data?.animation || "buff",
    eventId: uuidv4(),
    timestamp: Date.now(),
    cardId: card.user_card_instance_id,
  } as CardEvent;
}

type EventOptions = {
  name?: string;
  data?: Record<string, any>;
  animation?: string;
  position?: BoardPosition;
};

/**
 *
 * @param card - The card to add the debuff to
 * @param duration - The duration of the debuff
 * @param power - The power of the debuff (send a negative integer)
 * @param options - The options for the debuff
 * @returns A game event
 */
export function addTempDebuff(
  card: InGameCard,
  duration: number,
  power: number | Partial<PowerValues>,
  options?: EventOptions
): BaseGameEvent {
  if (!card.temporary_effects) {
    card.temporary_effects = [];
  }
  const negativePower =
    typeof power === "number"
      ? {
          top: power,
          bottom: power,
          left: power,
          right: power,
        }
      : power;

  card.temporary_effects.push({
    power: negativePower,
    duration,
    name: options?.name,
    data: options?.data,
    type: EffectType.Debuff,
  });

  return {
    type: EVENT_TYPES.CARD_POWER_CHANGED,
    animation: options?.animation || "debuff",
    eventId: uuidv4(),
    timestamp: Date.now(),
    cardId: card.user_card_instance_id,
    position: options?.position,
  } as CardEvent;
}

export function createOrUpdateBuff(
  card: InGameCard,
  duration: number,
  power: number | Partial<PowerValues>,
  name: string,
  data?: Record<string, any>
): BaseGameEvent {
  //create the initial buff if it doesn't exist
  if (!card.temporary_effects.some((effect) => effect.name === name)) {
    addTempBuff(card, duration, 0, name, data);
  }

  //increase the value by whatever was provided
  const existingBuff = card.temporary_effects.find(
    (effect) => effect.name === name
  );
  if (existingBuff) {
    if (typeof power === "number") {
      existingBuff.power.top! += power;
      existingBuff.power.bottom! += power;
      existingBuff.power.left! += power;
      existingBuff.power.right! += power;
    } else {
      existingBuff.power.top! += power.top || 0;
      existingBuff.power.bottom! += power.bottom || 0;
      existingBuff.power.left! += power.left || 0;
      existingBuff.power.right! += power.right || 0;
    }
  }

  //sync to state?
  card.current_power = updateCurrentPower(card);

  return {
    type: EVENT_TYPES.CARD_POWER_CHANGED,
    animation: data?.animation || "buff",
    eventId: uuidv4(),
    timestamp: Date.now(),
    cardId: card.user_card_instance_id,
  } as CardEvent;
}

/**
 *
 * @param card - The card to create or update the debuff for
 * @param duration - The duration of the debuff
 * @param power - The power of the debuff (send a positive integer)
 * @param name - The name of the debuff
 * @param data - The data of the debuff
 * @returns A game event
 */
export function createOrUpdateDebuff(
  card: InGameCard,
  duration: number,
  power: number | Partial<PowerValues>,
  name: string,
  data?: Record<string, any>
): BaseGameEvent {
  //create the initial debuff if it doesn't exist
  if (!card.temporary_effects.some((effect) => effect.name === name)) {
    addTempDebuff(card, duration, 0, { name, ...data });
  }

  //increase the value by whatever was provided
  const existingDebuff = card.temporary_effects.find(
    (effect) => effect.name === name
  );
  if (existingDebuff) {
    if (typeof power === "number") {
      existingDebuff.power.top! -= power;
      existingDebuff.power.bottom! -= power;
      existingDebuff.power.left! -= power;
      existingDebuff.power.right! -= power;
    } else {
      existingDebuff.power.top! -= power.top || 0;
      existingDebuff.power.bottom! -= power.bottom || 0;
      existingDebuff.power.left! -= power.left || 0;
      existingDebuff.power.right! -= power.right || 0;
    }
  }

  //sync to state?
  card.current_power = updateCurrentPower(card);

  return {
    type: EVENT_TYPES.CARD_POWER_CHANGED,
    animation: data?.animation || "debuff",
    eventId: uuidv4(),
    timestamp: Date.now(),
    cardId: card.user_card_instance_id,
  } as CardEvent;
}

export const getPositionOfCardById = (
  cardId: string,
  board: GameBoard
): BoardPosition | null => {
  for (let y = 0; y < board.length; y++) {
    for (let x = 0; x < board[y].length; x++) {
      if (board[y][x]?.card?.user_card_instance_id === cardId) {
        return { x, y };
      }
    }
  }
  return null;
};

export const isCorner = (position: BoardPosition, boardSize: number) => {
  const { x, y } = position;
  return (
    (x === 0 && y === 0) ||
    (x === 0 && y === boardSize - 1) ||
    (x === boardSize - 1 && y === 0) ||
    (x === boardSize - 1 && y === boardSize - 1)
  );
};

export const isEdge = (position: BoardPosition, boardSize: number) => {
  const { x, y } = position;
  return x === 0 || x === boardSize - 1 || y === 0 || y === boardSize - 1;
};

export const isTopRow = (position: BoardPosition, boardSize: number) => {
  const { y } = position;
  return y === 0;
};

export const isBottomRow = (position: BoardPosition, boardSize: number) => {
  const { y } = position;
  return y === boardSize - 1;
};

export const isLeftColumn = (position: BoardPosition, boardSize: number) => {
  const { x } = position;
  return x === 0;
};

export const isRightColumn = (position: BoardPosition, boardSize: number) => {
  const { x } = position;
  return x === boardSize - 1;
};

export const isValidPosition = (position: BoardPosition, boardSize: number) => {
  const { x, y } = position;
  return x >= 0 && x < boardSize && y >= 0 && y < boardSize;
};

export const getAdjacentPositions = (
  position: BoardPosition,
  boardSize: number
): BoardPosition[] => {
  const { x, y } = position;
  const directions = [
    { x: x - 1, y: y },
    { x: x + 1, y: y },
    { x: x, y: y - 1 },
    { x: x, y: y + 1 },
  ];

  return directions.filter((pos) => isValidPosition(pos, boardSize));
};

export const getDiagonallyAdjacentPositions = (
  position: BoardPosition,
  boardSize: number
): BoardPosition[] => {
  const { x, y } = position;
  const directions = [
    { x: x - 1, y: y - 1 },
    { x: x + 1, y: y - 1 },
    { x: x - 1, y: y + 1 },
    { x: x + 1, y: y + 1 },
  ];

  return directions.filter((pos) => isValidPosition(pos, boardSize));
};

export const getTileAtPosition = (
  position: BoardPosition,
  board: GameBoard
): BoardCell | null => {
  return board[position.y][position.x];
};

export const cardAtPosition = (
  position: BoardPosition,
  board: GameBoard
): InGameCard | null => {
  return board[position.y][position.x]?.card;
};

export const getAdjacentCards = (
  position: BoardPosition,
  board: GameBoard,
  options?: {
    owner?: "ally" | "enemy";
    playerId?: string;
    tag?: string;
    includeEmpty?: boolean;
    name?: string;
  }
): InGameCard[] => {
  const adjacentPositions = getAdjacentPositions(position, board.length);
  let cards = adjacentPositions
    .map((pos) => getTileAtPosition(pos, board)?.card)
    .filter((card) => {
      return card || options?.includeEmpty;
    }) as InGameCard[];

  if (options?.owner && options?.playerId) {
    cards = cards.filter((card) => {
      if (options.owner === "ally") {
        return card?.owner === options.playerId;
      } else {
        return card?.owner !== options.playerId;
      }
    });
  }

  if (options?.tag) {
    cards = cards.filter(
      (card) => card && card.base_card_data.tags?.includes(options.tag!)
    );
  }

  if (options?.name) {
    cards = cards.filter((card) => card?.base_card_data.name === options.name);
  }

  return cards;
};

export const getDiagonallyAdjacentCards = (
  position: BoardPosition,
  board: GameBoard,
  options?: {
    owner?: "ally" | "enemy";
    playerId?: string;
    tag?: string;
    includeEmpty?: boolean;
    name?: string;
  }
): InGameCard[] => {
  const positions = getDiagonallyAdjacentPositions(position, board.length);
  let cards = positions
    .map((pos) => getTileAtPosition(pos, board)?.card)
    .filter((card) => card) as InGameCard[];

  if (options?.owner && options?.playerId) {
    cards = cards.filter((card) => {
      if (options.owner === "ally") {
        return card?.owner === options.playerId;
      } else {
        return card?.owner !== options.playerId;
      }
    });
  }

  if (options?.tag) {
    cards = cards.filter(
      (card) => card && card.base_card_data.tags?.includes(options.tag!)
    );
  }

  if (options?.name) {
    cards = cards.filter((card) => card?.base_card_data.name === options.name);
  }

  return cards;
};

export const getStrongestAdjacentEnemy = (
  position: BoardPosition,
  board: GameBoard,
  playerId: string
): InGameCard | null => {
  const enemyCards = getAdjacentCards(position, board, {
    owner: "enemy",
    playerId,
  });

  if (enemyCards.length === 0) return null;

  return enemyCards.reduce((strongest, current) => {
    const strongestPower = getCardTotalPower(strongest);
    const currentPower = getCardTotalPower(current);
    return currentPower > strongestPower ? current : strongest;
  });
};

export const getFacingEnemy = (
  position: BoardPosition,
  board: GameBoard
): InGameCard | null => {
  // Assuming "facing" means the card directly opposite based on board center
  const boardCenter = Math.floor(board.length / 2);
  const { x, y } = position;

  let facingPosition: BoardPosition;

  // Calculate opposing position based on board center
  if (x < boardCenter) {
    facingPosition = { x: board.length - 1 - x, y };
  } else if (x > boardCenter) {
    facingPosition = { x: board.length - 1 - x, y };
  } else if (y < boardCenter) {
    facingPosition = { x, y: board.length - 1 - y };
  } else {
    facingPosition = { x, y: board.length - 1 - y };
  }

  if (!isValidPosition(facingPosition, board.length)) return null;

  const facingCell = getTileAtPosition(facingPosition, board);
  return facingCell?.card || null;
};

export const isSurrounded = (
  position: BoardPosition,
  board: GameBoard
): boolean => {
  const adjacentCards = getAdjacentCards(position, board);
  return adjacentCards.length >= 2;
};

export const getAlliesAdjacentTo = (
  position: BoardPosition,
  board: GameBoard,
  playerId: string
): InGameCard[] => {
  return getAdjacentCards(position, board, {
    owner: "ally",
    playerId,
  });
};

export const getEnemiesAdjacentTo = (
  position: BoardPosition,
  board: GameBoard,
  playerId: string
): InGameCard[] => {
  return getAdjacentCards(position, board, {
    owner: "enemy",
    playerId,
  });
};

export const getCardTotalPower = (card: InGameCard): number => {
  const currentPower = updateCurrentPower(card);
  return (
    currentPower.top +
    currentPower.bottom +
    currentPower.left +
    currentPower.right
  );
};

export const isFlankedByEnemies = (
  position: BoardPosition,
  board: GameBoard,
  playerId: string
): boolean => {
  const adjacentEnemies = getEnemiesAdjacentTo(position, board, playerId);
  if (adjacentEnemies.length < 2) {
    return false;
  }
  // Check for opposite pairs
  const positions = adjacentEnemies
    .map((card) => {
      for (let y = 0; y < board.length; y++) {
        for (let x = 0; x < board.length; x++) {
          if (
            board[y][x]?.card?.user_card_instance_id ===
            card.user_card_instance_id
          ) {
            return { x, y };
          }
        }
      }
      return null;
    })
    .filter((p) => p) as BoardPosition[];

  const hasHorizontalFlank = positions.some((p) =>
    positions.some((other) => p.y === other.y && Math.abs(p.x - other.x) === 2)
  );
  const hasVerticalFlank = positions.some((p) =>
    positions.some((other) => p.x === other.x && Math.abs(p.y - other.y) === 2)
  );

  return hasHorizontalFlank || hasVerticalFlank;
};

export const getCardsByCondition = (
  board: GameBoard,
  filterFn: (card: InGameCard) => boolean
): InGameCard[] => {
  const cards: InGameCard[] = [];
  for (const row of board) {
    for (const cell of row) {
      if (cell?.card && filterFn(cell.card)) {
        cards.push(cell.card);
      }
    }
  }
  return cards;
};

export const countCornersControlled = (
  board: GameBoard,
  playerId: string
): number => {
  const corners = [
    board[0][0],
    board[0][board.length - 1],
    board[board.length - 1][0],
    board[board.length - 1][board.length - 1],
  ];
  return corners.filter((cell) => cell?.card?.owner === playerId).length;
};

export const rerollHighestStat = (card: InGameCard): void => {
  let highestStat: keyof PowerValues | null = null;
  let maxPower = -1;

  for (const [stat, power] of Object.entries(card.current_power)) {
    if (power > maxPower) {
      maxPower = power;
      highestStat = stat as keyof PowerValues;
    }
  }

  if (highestStat) {
    // Assuming a reroll means setting it to a new random value, e.g., between 1 and 10
    card.current_power[highestStat] = Math.floor(Math.random() * 10) + 1;
  }
};

export const destroyCardAtPosition = (
  position: BoardPosition,
  board: GameBoard,
  animation?: string,
  actingPlayerId?: string
): BaseGameEvent | null => {
  const tile = getTileAtPosition(position, board);
  if (!tile?.card) return null;

  const cardId = tile.card.user_card_instance_id;
  const owner = tile.card.owner;

  tile.card = null;

  // Track daily task progress for card destruction (fire-and-forget)
  if (actingPlayerId) {
    try {
      DailyTaskService.trackDestroy(actingPlayerId).catch(() => {});
    } catch (error) {
      // Silently ignore tracking errors during gameplay
    }
  }

  return {
    type: EVENT_TYPES.CARD_REMOVED_FROM_BOARD,
    eventId: uuidv4(),
    timestamp: Date.now(),
    cardId,
    reason: "destroyed",
    sourcePlayerId: owner,
    animation: animation || "destroy",
    position,
  } as CardEvent;
};

export const resetTile = (
  tile: BoardCell,
  position: BoardPosition
): BaseGameEvent => {
  tile.tile_effect = undefined;

  return {
    type: EVENT_TYPES.TILE_STATE_CHANGED,
    eventId: uuidv4(),
    timestamp: Date.now(),
    position,
    tile: { tile_effect: tile.tile_effect },
  } as TileEvent;
};

export const setTileStatus = (
  tile: BoardCell,
  position: BoardPosition,
  effect: TileEffect,
  actingPlayerId?: string
): BaseGameEvent => {
  tile.tile_effect = effect;

  const { tile_effect } = tile;

  // Track daily task progress for curses (fire-and-forget)
  if (actingPlayerId && effect.status === TileStatus.Cursed) {
    try {
      DailyTaskService.trackCurse(actingPlayerId).catch(() => {});
    } catch (error) {
      // Silently ignore tracking errors during gameplay
    }
  }

  // Track daily task progress for blessings (fire-and-forget)
  if (actingPlayerId && effect.status === TileStatus.Boosted) {
    try {
      DailyTaskService.trackBless(actingPlayerId).catch(() => {});
    } catch (error) {
      // Silently ignore tracking errors during gameplay
    }
  }

  return {
    type: EVENT_TYPES.TILE_STATE_CHANGED,
    eventId: uuidv4(),
    timestamp: Date.now(),
    position,
    tile: { tile_effect },
  } as TileEvent;
};

export const getRandomEmptyTile = (
  board: GameBoard
): { position: BoardPosition; tile: BoardCell } | null => {
  const emptyTiles: Array<{ position: BoardPosition; tile: BoardCell }> = [];

  // Iterate through all tiles on the board
  for (let y = 0; y < board.length; y++) {
    for (let x = 0; x < board[y].length; x++) {
      const tile = board[y][x];
      // Check if tile has no card and no tile effect
      if (tile && !tile.card && !tile.tile_effect) {
        emptyTiles.push({ position: { x, y }, tile });
      }
    }
  }

  // Return null if no empty tiles found
  if (emptyTiles.length === 0) {
    return null;
  }

  // Return a random empty tile with its position
  const randomIndex = Math.floor(Math.random() * emptyTiles.length);
  return emptyTiles[randomIndex];
};

export function getCardsInSameRow(
  position: BoardPosition,
  board: GameBoard,
  excludePlayerId?: string
): InGameCard[] {
  const cards: InGameCard[] = [];
  const { y } = position;

  for (let x = 0; x < board.length; x++) {
    const cell = board[y][x];
    if (cell?.card) {
      if (!excludePlayerId || cell.card.owner !== excludePlayerId) {
        cards.push(cell.card);
      }
    }
  }
  return cards;
}

export function getCardsInSameColumn(
  position: BoardPosition,
  board: GameBoard,
  excludePlayerId?: string
): InGameCard[] {
  const cards: InGameCard[] = [];
  const { x } = position;

  for (let y = 0; y < board.length; y++) {
    const cell = board[y][x];
    if (cell?.card) {
      if (!excludePlayerId || cell.card.owner !== excludePlayerId) {
        cards.push(cell.card);
      }
    }
  }
  return cards;
}

export function removeTemporaryBuffs(
  card: InGameCard,
  animation?: string
): BaseGameEvent {
  // Remove positive temporary effects only, keeping debuffs
  if (card.temporary_effects) {
    card.temporary_effects = card.temporary_effects.filter((effect) => {
      const totalPowerChange = Object.values(effect.power).reduce(
        (sum, val) => sum + (val || 0),
        0
      );
      return totalPowerChange <= 0; // Keep debuffs, remove buffs
    });
  }

  return {
    type: EVENT_TYPES.CARD_POWER_CHANGED,
    animation: animation || "buff-removed",
    eventId: uuidv4(),
    timestamp: Date.now(),
    cardId: card.user_card_instance_id,
  } as CardEvent;
}

export function removeBuffsByCondition(
  card: InGameCard,
  condition: (effect: TemporaryEffect) => boolean,
  animation?: string
): BaseGameEvent {
  if (card.temporary_effects) {
    card.temporary_effects = card.temporary_effects.filter(
      (effect) => !condition(effect)
    );
  }
  return {
    type: EVENT_TYPES.CARD_POWER_CHANGED,
    animation: animation || "buff-removed",
    eventId: uuidv4(),
    timestamp: Date.now(),
    cardId: card.user_card_instance_id,
  } as CardEvent;
}

// New utility functions for Polynesian abilities
export function getEmptyAdjacentTiles(
  position: BoardPosition,
  board: GameBoard
): Array<{ position: BoardPosition; tile: BoardCell }> {
  const adjacentPositions = getAdjacentPositions(position, board.length);
  const emptyTiles: Array<{ position: BoardPosition; tile: BoardCell }> = [];

  for (const pos of adjacentPositions) {
    const tile = getTileAtPosition(pos, board);
    if (tile && !tile.card) {
      emptyTiles.push({ position: pos, tile });
    }
  }

  return emptyTiles;
}

/**
 * Returns all tiles surrounding the given position (diagonal as well as adjacent)
 * @param position
 * @param board
 */
export function getSurroundingTiles(
  position: BoardPosition,
  board: GameBoard
): Array<{ position: BoardPosition; tile: BoardCell }> {
  const diagonallyAdjacentPositions = getDiagonallyAdjacentPositions(
    position,
    board.length
  );
  const adjacentPositions = getAdjacentPositions(position, board.length);

  const surroundingPositions = [
    ...diagonallyAdjacentPositions,
    ...adjacentPositions,
  ];
  const surroundingTiles = surroundingPositions.map((pos) => ({
    position: pos,
    tile: getTileAtPosition(pos, board),
  }));

  return surroundingTiles.filter((tile) => tile.tile) as Array<{
    position: BoardPosition;
    tile: BoardCell;
  }>;
}

export function cleanseDebuffs(
  card: InGameCard,
  count: number,
  animation?: string
): BaseGameEvent {
  // Remove negative temporary effects (debuffs) up to the specified count
  if (card.temporary_effects) {
    let removed = 0;
    card.temporary_effects = card.temporary_effects.filter((effect) => {
      if (removed >= count) return true;

      const totalPowerChange = Object.values(effect.power).reduce(
        (sum, val) => sum + (val || 0),
        0
      );

      if (totalPowerChange < 0) {
        removed++;
        return false; // Remove this debuff
      }
      return true;
    });
  }

  return {
    type: EVENT_TYPES.CARD_POWER_CHANGED,
    animation: animation || "cleanse",
    eventId: uuidv4(),
    timestamp: Date.now(),
    cardId: card.user_card_instance_id,
  } as CardEvent;
}

export function getAllAlliesOnBoard(
  board: GameBoard,
  playerId: string
): InGameCard[] {
  return getCardsByCondition(board, (card) => card.owner === playerId);
}

export function getCardHighestPower(card: InGameCard): {
  key: "top" | "bottom" | "left" | "right";
  value: number;
} {
  const keys: Array<"top" | "bottom" | "left" | "right"> = [
    "top",
    "bottom",
    "left",
    "right",
  ];
  let maxKey: "top" | "bottom" | "left" | "right" = "top";
  let maxValue = card.current_power.top;

  for (const key of keys) {
    if (card.current_power[key] > maxValue) {
      maxValue = card.current_power[key];
      maxKey = key;
    }
  }

  return { key: maxKey, value: maxValue };
}
/**
 * Applies tile effects to a card when it moves to a new position
 * Returns events for any tile effects that were applied
 */
export function applyTileEffectsToMovedCard(
  card: InGameCard,
  newPosition: BoardPosition,
  board: GameBoard
): BaseGameEvent[] {
  const events: BaseGameEvent[] = [];
  const newTile = getTileAtPosition(newPosition, board);

  if (newTile?.tile_effect) {
    const tileEffectTransferred = transferTileEffectToCard(
      card,
      newTile.tile_effect
    );

    if (tileEffectTransferred) {
      // Update the card's current power after applying tile effect
      card.current_power = updateCurrentPower(card);

      events.push({
        type: EVENT_TYPES.CARD_POWER_CHANGED,
        eventId: uuidv4(),
        timestamp: Date.now(),
        cardId: card.user_card_instance_id,
        position: newPosition,
      } as CardEvent);
    }
  }

  return events;
}

export function pushCardAway(
  card: InGameCard,
  fromPosition: BoardPosition,
  board: GameBoard
): BaseGameEvent[] {
  const events: BaseGameEvent[] = [];

  // Find the card's current position
  let cardPosition: BoardPosition | null = null;
  for (let y = 0; y < board.length; y++) {
    for (let x = 0; x < board.length; x++) {
      if (
        board[y][x]?.card?.user_card_instance_id === card.user_card_instance_id
      ) {
        cardPosition = { x, y };
        break;
      }
    }
    if (cardPosition) break;
  }

  if (!cardPosition) return events;

  // Calculate push direction (away from the triggering position)
  const deltaX = cardPosition.x - fromPosition.x;
  const deltaY = cardPosition.y - fromPosition.y;

  // Normalize to get direction
  const newX = cardPosition.x + (deltaX !== 0 ? Math.sign(deltaX) : 0);
  const newY = cardPosition.y + (deltaY !== 0 ? Math.sign(deltaY) : 0);

  const newPosition = { x: newX, y: newY };

  // Check if new position is valid and empty
  if (
    !isValidPosition(newPosition, board.length) ||
    getTileAtPosition(newPosition, board)?.card
  ) {
    return events; // Can't push if destination is invalid or occupied
  }

  // Move the card
  const currentTile = getTileAtPosition(cardPosition, board);
  const newTile = getTileAtPosition(newPosition, board);

  if (currentTile && newTile) {
    newTile.card = card;
    currentTile.card = null;

    events.push({
      type: EVENT_TYPES.CARD_MOVED,
      eventId: uuidv4(),
      timestamp: Date.now(),
      cardId: card.user_card_instance_id,
      fromPosition: cardPosition,
      toPosition: newPosition,
      animation: "push",
    } as CardEvent);

    // Apply tile effects to the moved card
    events.push(...applyTileEffectsToMovedCard(card, newPosition, board));
  }

  return events;
}

export function pullCardsIn(
  position: BoardPosition,
  board: GameBoard,
  playerId: string
): BaseGameEvent[] {
  const gameEvents: BaseGameEvent[] = [];

  // Define the four directions: up, down, left, right
  const directions = [
    { x: 0, y: -2 }, // up 2 spaces
    { x: 0, y: 2 }, // down 2 spaces
    { x: -2, y: 0 }, // left 2 spaces
    { x: 2, y: 0 }, // right 2 spaces
  ];

  for (const direction of directions) {
    const enemyPosition = {
      x: position.x + direction.x,
      y: position.y + direction.y,
    };

    const intermediatePosition = {
      x: position.x + direction.x / 2,
      y: position.y + direction.y / 2,
    };

    // Check if enemy position is valid
    if (!isValidPosition(enemyPosition, board.length)) {
      continue;
    }

    // Check if there's an enemy card at this position
    const enemyTile = getTileAtPosition(enemyPosition, board);
    const enemyCard = enemyTile?.card;

    if (!enemyCard || enemyCard.owner === playerId) {
      continue; // No card or it's our own card
    }

    // Check if intermediate position is empty
    const intermediateTile = getTileAtPosition(intermediatePosition, board);
    if (intermediateTile?.card) {
      continue; // Can't pull if there's a card in the way
    }

    // Move the enemy card to the intermediate position
    const currentTile = getTileAtPosition(enemyPosition, board);

    if (currentTile && intermediateTile) {
      intermediateTile.card = enemyCard;
      currentTile.card = null;

      gameEvents.push({
        type: EVENT_TYPES.CARD_MOVED,
        eventId: uuidv4(),
        timestamp: Date.now(),
        cardId: enemyCard.user_card_instance_id,
        fromPosition: enemyPosition,
        toPosition: intermediatePosition,
        animation: "pull",
      } as CardEvent);

      // Apply tile effects to the moved card
      gameEvents.push(
        ...applyTileEffectsToMovedCard(enemyCard, intermediatePosition, board)
      );
    }
  }

  return gameEvents;
}

export function moveCardToPosition(
  card: InGameCard,
  toPosition: BoardPosition,
  fromPosition: BoardPosition,
  board: GameBoard,
  animation?: string
): BaseGameEvent[] {
  if (toPosition.x === fromPosition.x && toPosition.y === fromPosition.y)
    throw new Error("Cannot move to the same position");
  if (
    !isValidPosition(toPosition, board.length) ||
    !isValidPosition(fromPosition, board.length)
  )
    throw new Error("Invalid positions");

  const currentTile = getTileAtPosition(fromPosition, board);
  const newTile = getTileAtPosition(toPosition, board);

  if (!currentTile || !newTile) throw new Error("Invalid positions");

  newTile.card = currentTile.card;
  currentTile.card = null;

  const gameEvents: BaseGameEvent[] = [
    {
      type: EVENT_TYPES.CARD_MOVED,
      animation: animation || "pull",
      eventId: uuidv4(),
      timestamp: Date.now(),
      cardId: card.user_card_instance_id,
      fromPosition: fromPosition,
      toPosition: toPosition,
    } as CardEvent,
  ];

  gameEvents.push(...applyTileEffectsToMovedCard(card, toPosition, board));

  return gameEvents;
}

// TODO: This function needs proper turn tracking implementation
export function getAlternatingTurnEffect(
  turnNumber: number,
  effectA: any,
  effectB: any
): any {
  // Placeholder implementation - needs actual turn tracking
  return turnNumber % 2 === 0 ? effectA : effectB;
}

export function disableAbilities(
  card: InGameCard,
  turns: number
): BaseGameEvent {
  // TODO: Need to implement ability disabling system
  // This would require adding a disabled_abilities field to the card or a game state system
  // For now, we'll use a temporary effect to mark the card as disabled

  if (!card.temporary_effects) {
    card.temporary_effects = [];
  }

  // return {
  //   type: EVENT_TYPES.CARD_POWER_CHANGED,
  //   animation: "abilities-disabled",
  //   eventId: uuidv4(),
  //   timestamp: Date.now(),
  //   cardId: card.user_card_instance_id,
  // } as CardEvent;
  return {
    type: EVENT_TYPES.CARD_POWER_CHANGED,
    animation: "abilities-disabled",
    eventId: uuidv4(),
    timestamp: Date.now(),
    cardId: card.user_card_instance_id,
  } as CardEvent;
}

export function addTileBlessing(
  position: BoardPosition,
  bonus: number,
  ownerId: string,
  actingPlayerId?: string
): BaseGameEvent {
  // Track daily task progress for blessings (fire-and-forget)
  if (actingPlayerId) {
    try {
      DailyTaskService.trackBless(actingPlayerId).catch(() => {});
    } catch (error) {
      // Silently ignore tracking errors during gameplay
    }
  }

  return {
    type: EVENT_TYPES.TILE_STATE_CHANGED,
    eventId: uuidv4(),
    timestamp: Date.now(),
    position,
    tile: {
      tile_enabled: true,
      tile_effect: {
        status: TileStatus.Boosted,
        turns_left: 1000,
        animation_label: `blessed-${bonus}`,
        power: { top: bonus, bottom: bonus, left: bonus, right: bonus },
        applies_to_user: ownerId,
      },
    },
  } as TileEvent;
}

export function protectFromDefeat(
  card: InGameCard,
  turns: number
): BaseGameEvent {
  if (!card.temporary_effects) {
    card.temporary_effects = [];
  }

  card.temporary_effects.push({
    power: { top: 0, bottom: 0, left: 0, right: 0 },
    duration: turns,
    type: EffectType.BlockDefeat,
  });

  return {
    type: EVENT_TYPES.CARD_POWER_CHANGED,
    animation: "protected",
    eventId: uuidv4(),
    timestamp: Date.now(),
    cardId: card.user_card_instance_id,
  } as CardEvent;
}

export function blockTile(
  position: BoardPosition,
  board: GameBoard,
  turns = 2,
  animationLabel = "frozen"
): BaseGameEvent | undefined {
  // if this is the last open tile on the board, return undefined
  const openTiles = board.flat().filter((tile) => tile.card === null);
  simulationContext.debugLog("open tiles: ", openTiles);
  if (openTiles.length <= 1) return undefined;

  const tile = getTileAtPosition(position, board);
  if (!tile) return undefined;

  return setTileStatus(tile, position, {
    status: TileStatus.Blocked,
    turns_left: turns,
    animation_label: animationLabel,
  });
}

/**
 * Gets a random card from the board with optional filtering by tags and owner ID
 * @param board - The game board to search
 * @param options - Optional filtering parameters
 * @returns A random card matching the criteria, or null if none found
 */
export function getRandomCard(
  board: GameBoard,
  options?: {
    tags?: string[];
    ownerId?: string;
    excludeOwnerId?: string;
    excludeCardId?: string;
  }
): InGameCard | null {
  let cards = getCardsByCondition(board, (card) => {
    // Filter by owner ID if specified
    if (options?.ownerId && card.owner !== options.ownerId) {
      return false;
    }

    // Exclude specific owner ID if specified
    if (options?.excludeOwnerId && card.owner === options.excludeOwnerId) {
      return false;
    }

    // Exclude specific card ID if specified
    if (
      options?.excludeCardId &&
      card.user_card_instance_id === options.excludeCardId
    ) {
      return false;
    }

    // Filter by tags if specified (card must have ALL specified tags)
    if (options?.tags && options.tags.length > 0) {
      const cardTags = card.base_card_data.tags || [];
      return options.tags.every((tag) => cardTags.includes(tag));
    }

    return true;
  });

  if (cards.length === 0) {
    return null;
  }

  // Return a random card from the filtered results
  const randomIndex = Math.floor(Math.random() * cards.length);
  return cards[randomIndex];
}

export function getRandomSide(): "top" | "bottom" | "left" | "right" {
  const sides = ["top", "bottom", "left", "right"] as const;
  return sides[Math.floor(Math.random() * sides.length)];
}

export function chooseRandomCard(cards: InGameCard[]): InGameCard {
  return cards[Math.floor(Math.random() * cards.length)];
}
