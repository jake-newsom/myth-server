import { InGameCard, PowerValues } from "../types/card.types";
import { BoardCell, BoardPosition, GameBoard } from "../types/game.types";

export function updateCurrentPower(card: InGameCard): PowerValues {
  const currentPower: PowerValues = structuredClone(
    card.base_card_data.base_power
  );

  (["top", "bottom", "left", "right"] as (keyof PowerValues)[]).forEach(
    (direction) => {
      const modPositive = card.card_modifiers_positive[direction];
      const modNegative = card.card_modifiers_negative[direction];
      const modEnhancement = card.power_enhancements[direction];

      currentPower[direction] += modPositive - modNegative + modEnhancement;
    }
  );

  return currentPower;
}

export function buff(card: InGameCard, amount: number | PowerValues) {
  if (typeof amount === "number") {
    card.card_modifiers_positive = {
      top: (card.card_modifiers_positive?.top ?? 0) + amount,
      bottom: (card.card_modifiers_positive?.bottom ?? 0) + amount,
      left: (card.card_modifiers_positive?.left ?? 0) + amount,
      right: (card.card_modifiers_positive?.right ?? 0) + amount,
    };
  } else {
    card.card_modifiers_positive = {
      top: (card.card_modifiers_positive?.top ?? 0) + amount.top,
      bottom: (card.card_modifiers_positive?.bottom ?? 0) + amount.bottom,
      left: (card.card_modifiers_positive?.left ?? 0) + amount.left,
      right: (card.card_modifiers_positive?.right ?? 0) + amount.right,
    };
  }
}

export function debuff(card: InGameCard, amount: number | PowerValues) {
  if (typeof amount === "number") {
    card.card_modifiers_negative = {
      top: (card.card_modifiers_negative?.top ?? 0) + amount,
      bottom: (card.card_modifiers_negative?.bottom ?? 0) + amount,
      left: (card.card_modifiers_negative?.left ?? 0) + amount,
      right: (card.card_modifiers_negative?.right ?? 0) + amount,
    };
  } else {
    card.card_modifiers_negative = {
      top: (card.card_modifiers_negative?.top ?? 0) + amount.top,
      bottom: (card.card_modifiers_negative?.bottom ?? 0) + amount.bottom,
      left: (card.card_modifiers_negative?.left ?? 0) + amount.left,
      right: (card.card_modifiers_negative?.right ?? 0) + amount.right,
    };
  }
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
      if (!options?.includeEmpty && card === null) return false;
      return true;
    }) as InGameCard[];

  if (options?.owner && options?.playerId) {
    cards = cards.filter((card) => {
      if (options.owner === "ally") {
        return card.owner === options.playerId;
      } else {
        return card.owner !== options.playerId;
      }
    });
  }

  if (options?.tag) {
    cards = cards.filter((card) =>
      card.base_card_data.tags?.includes(options.tag!)
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

export const applyTemporaryBuff = (
  card: InGameCard,
  amount: number | PowerValues,
  duration: number
): void => {
  // Note: temporary_buffs is not part of InGameCard interface
  // This would need to be added to the type definition or handled differently
  // For now, commenting out the implementation
  console.warn(
    "Temporary buffs system needs to be implemented in card type definition"
  );

  // TODO: Implement temporary buff system by either:
  // 1. Adding temporary_buffs to InGameCard interface
  // 2. Using a separate tracking system
  // 3. Using existing card_modifiers_positive/negative with duration tracking
};

export const isFlankedByEnemies = (
  position: BoardPosition,
  board: GameBoard,
  playerId: string
): boolean => {
  const { x, y } = position;

  // Check horizontal flanking (left and right)
  const leftPos = { x: x - 1, y };
  const rightPos = { x: x + 1, y };
  const leftCard = getTileAtPosition(leftPos, board)?.card;
  const rightCard = getTileAtPosition(rightPos, board)?.card;
  const horizontalFlank =
    isValidPosition(leftPos, board.length) &&
    isValidPosition(rightPos, board.length) &&
    leftCard !== null &&
    leftCard !== undefined &&
    leftCard.owner !== playerId &&
    rightCard !== null &&
    rightCard !== undefined &&
    rightCard.owner !== playerId;

  // Check vertical flanking (top and bottom)
  const topPos = { x, y: y - 1 };
  const bottomPos = { x, y: y + 1 };
  const topCard = getTileAtPosition(topPos, board)?.card;
  const bottomCard = getTileAtPosition(bottomPos, board)?.card;
  const verticalFlank =
    isValidPosition(topPos, board.length) &&
    isValidPosition(bottomPos, board.length) &&
    topCard !== null &&
    topCard !== undefined &&
    topCard.owner !== playerId &&
    bottomCard !== null &&
    bottomCard !== undefined &&
    bottomCard.owner !== playerId;

  return horizontalFlank || verticalFlank;
};

export const getCardsByCondition = (
  board: GameBoard,
  filterFn: (card: InGameCard) => boolean
): InGameCard[] => {
  const cards: InGameCard[] = [];

  for (let y = 0; y < board.length; y++) {
    for (let x = 0; x < board[y].length; x++) {
      const cell = board[y][x];
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
    { x: 0, y: 0 },
    { x: 0, y: board.length - 1 },
    { x: board.length - 1, y: 0 },
    { x: board.length - 1, y: board.length - 1 },
  ];

  return corners.filter((corner) => {
    const cell = getTileAtPosition(corner, board);
    return cell?.card?.owner === playerId;
  }).length;
};

export const rerollHighestStat = (card: InGameCard): void => {
  const currentPower = updateCurrentPower(card);
  const directions = ["top", "bottom", "left", "right"] as const;

  // Find the direction with the highest power
  let highestDirection: keyof PowerValues = directions[0];
  let highestValue = currentPower[highestDirection];

  directions.forEach((direction) => {
    if (currentPower[direction] > highestValue) {
      highestValue = currentPower[direction];
      highestDirection = direction;
    }
  });

  // Reroll the highest stat (generate new random value between 1-10)
  const newValue = Math.floor(Math.random() * 10) + 1;
  card.base_card_data.base_power[highestDirection] = newValue;
};
