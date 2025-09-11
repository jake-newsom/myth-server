import {
  GameState,
  BoardPosition,
  BoardCell,
  TileStatus,
} from "../types/game.types";

const BOARD_SIZE = 4;

export function isPlayerTurn(gameState: GameState, playerId: string): boolean {
  return gameState.current_player_id === playerId;
}

export function canPlaceOnTile(
  gameState: GameState,
  position: BoardPosition
): { canPlace: boolean; errorMessage: string } {
  if (!isValidBoardPosition(position)) {
    return { canPlace: false, errorMessage: "Invalid board position." };
  }

  if (isBoardPositionOccupied(gameState, position)) {
    return {
      canPlace: false,
      errorMessage: `Board position ${position.x},${
        position.y
      } is occupied: ${JSON.stringify(
        gameState.board[position.y][position.x].card
      )}`,
    };
  }

  if (isBoardPositionBlocked(gameState, position)) {
    return { canPlace: false, errorMessage: "Board position is blocked." };
  }

  return { canPlace: true, errorMessage: "" };
}

export function isValidBoardPosition(position: BoardPosition): boolean {
  const result =
    position.x >= 0 &&
    position.x < BOARD_SIZE &&
    position.y >= 0 &&
    position.y < BOARD_SIZE;
  return result;
}

export function isBoardPositionOccupied(
  gameState: GameState,
  position: BoardPosition
): boolean {
  const cell = gameState.board[position.y][position.x];
  return cell.card !== null;
}

export function isBoardPositionBlocked(
  gameState: GameState,
  position: BoardPosition
): boolean {
  const cell = gameState.board[position.y][position.x];

  if (cell.tile_effect?.status === TileStatus.Blocked) return true;
  if (cell.tile_effect?.status === TileStatus.Removed) return true;

  return cell.tile_enabled === false;
}

export function getExistingCardAtPosition(
  gameState: GameState,
  position: BoardPosition
): BoardCell | null {
  const cell = gameState.board[position.y][position.x];
  return cell;
}

export function isCardInPlayerHand(
  gameState: GameState,
  playerId: string,
  userCardInstanceId: string
): boolean {
  const player =
    gameState.player1.user_id === playerId
      ? gameState.player1
      : gameState.player2;

  return player.hand.indexOf(userCardInstanceId) !== -1;
}

export function getCardIndexInHand(
  gameState: GameState,
  playerId: string,
  userCardInstanceId: string
): number {
  const player =
    gameState.player1.user_id === playerId
      ? gameState.player1
      : gameState.player2;

  return player.hand.indexOf(userCardInstanceId);
}

export function getPlayer(gameState: GameState, playerId: string) {
  return gameState.player1.user_id === playerId
    ? gameState.player1
    : gameState.player2;
}

export function getOpponent(gameState: GameState, playerId: string) {
  return gameState.player1.user_id === playerId
    ? gameState.player2
    : gameState.player1;
}

export function checkAdjacentCells(
  board: (BoardCell | null)[][],
  position: BoardPosition,
  playerId: string
): { x: number; y: number; direction: { from: string; to: string } }[] {
  const directions = [
    { dx: 0, dy: -1, from: "bottom", to: "top" }, // Card above
    { dx: 1, dy: 0, from: "left", to: "right" }, // Card to the right
    { dx: 0, dy: 1, from: "top", to: "bottom" }, // Card below
    { dx: -1, dy: 0, from: "right", to: "left" }, // Card to the left
  ];

  const adjacentOpponentCells = [];

  for (const dir of directions) {
    const nx = position.x + dir.dx;
    const ny = position.y + dir.dy;

    if (
      nx >= 0 &&
      nx < BOARD_SIZE &&
      ny >= 0 &&
      ny < BOARD_SIZE &&
      board[ny][nx] &&
      board[ny][nx]!.card &&
      board[ny][nx]!.card!.owner !== playerId
    ) {
      adjacentOpponentCells.push({
        x: nx,
        y: ny,
        direction: { from: dir.from, to: dir.to },
      });
    }
  }

  return adjacentOpponentCells;
}

export function isBoardFull(board: (BoardCell | null)[][]): boolean {
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[y][x]?.card === null) {
        return false;
      }
    }
  }
  return true;
}

export function calculateScores(
  board: (BoardCell | null)[][],
  player1Id: string,
  player2Id: string
): { player1Score: number; player2Score: number } {
  let player1Score = 0;
  let player2Score = 0;

  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[y][x] !== null && board[y][x]!.card) {
        if (board[y][x]!.card!.owner === player1Id) {
          player1Score++;
        } else if (board[y][x]!.card!.owner === player2Id) {
          player2Score++;
        }
      }
    }
  }

  return { player1Score, player2Score };
}

export function shouldDrawCard(player: any, maxCardsInHand: number): boolean {
  return player.hand.length < maxCardsInHand && player.deck.length > 0;
}

export function determineGameOutcome(
  player1Score: number,
  player2Score: number,
  player1Id: string,
  player2Id: string
): string | null {
  if (player1Score > player2Score) {
    return player1Id;
  } else if (player2Score > player1Score) {
    return player2Id;
  } else {
    return null; // Draw
  }
}
