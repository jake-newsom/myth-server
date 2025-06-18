import { InGameCard, PowerValues, TemporaryEffect } from "../types/card.types";
import {
  BoardCell,
  BoardPosition,
  GameBoard,
  TileStatus,
} from "../types/game.types";
import {
  BaseGameEvent,
  CardEvent,
  EVENT_TYPES,
  TileEvent,
} from "./game-events";

import { v4 as uuidv4 } from "uuid";

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

  return currentPower;
}

export function buff(
  card: InGameCard,
  amount: number | PowerValues
): BaseGameEvent {
  return addTempBuff(card, 1000, amount);
}

export function debuff(
  card: InGameCard,
  amount: number | PowerValues
): BaseGameEvent {
  return addTempDebuff(card, 1000, amount);
}

export function addTempBuff(
  card: InGameCard,
  duration: number,
  power: number | Partial<PowerValues>
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
  });

  return {
    type: EVENT_TYPES.CARD_POWER_CHANGED,
    animation: "buff",
    eventId: uuidv4(),
    timestamp: Date.now(),
    cardId: card.user_card_instance_id,
  } as CardEvent;
}

export function addTempDebuff(
  card: InGameCard,
  duration: number,
  power: number | Partial<PowerValues>
): BaseGameEvent {
  if (!card.temporary_effects) {
    card.temporary_effects = [];
  }
  const negativePower =
    typeof power === "number"
      ? {
          top: -power,
          bottom: -power,
          left: -power,
          right: -power,
        }
      : power;

  card.temporary_effects.push({
    power: negativePower,
    duration,
  });

  return {
    type: EVENT_TYPES.CARD_POWER_CHANGED,
    animation: "debuff",
    eventId: uuidv4(),
    timestamp: Date.now(),
    cardId: card.user_card_instance_id,
  } as CardEvent;
}

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

export const getTileAtPosition = (
  position: BoardPosition,
  board: GameBoard
): BoardCell | null => {
  return board[position.y][position.x];
};

export const getAdjacentCards = (
  position: BoardPosition,
  board: GameBoard,
  options?: {
    owner?: "ally" | "enemy";
    playerId?: string;
    tag?: string;
    includeEmpty?: boolean;
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

export const setTileStatus = (
  tile: BoardCell,
  position: BoardPosition,
  status: TileStatus,
  turnsLeft: number,
  animationLabel: string
): BaseGameEvent => {
  tile.tile_status = status;
  tile.turns_left = turnsLeft;
  tile.animation_label = animationLabel;

  const { tile_status, turns_left, animation_label } = tile;

  return {
    type: EVENT_TYPES.TILE_STATE_CHANGED,
    eventId: uuidv4(),
    timestamp: Date.now(),
    position,
    tile: { tile_status, turns_left, animation_label },
  } as TileEvent;
};
