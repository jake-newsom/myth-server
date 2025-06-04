import { GameLogic } from "./game.logic";
import { GameState, BoardPosition } from "../types/game.types";
import { InGameCard } from "../types/card.types";
import * as _ from "lodash";

const BOARD_SIZE = 4;

export class AILogic {
  // Evaluate move needs to use the current_power of the hydrated card instance
  evaluateMove(
    gameState: GameState,
    cardToPlay: InGameCard,
    position: BoardPosition,
    aiPlayerId: string
  ): number {
    let score = 0;
    const tempBoard = _.cloneDeep(gameState.board);

    // Simulate placement with the card instance's actual power and level
    tempBoard[position.y][position.x] = {
      card: cardToPlay,
      tile_status: "normal",
      player_1_turns_left: 0,
      player_2_turns_left: 0,
      animation_label: null,
    };

    let potentialFlips = 0;
    const directions = [
      { dx: 0, dy: -1, from: "bottom", to: "top" }, // Card above
      { dx: 1, dy: 0, from: "left", to: "right" }, // Card to the right
      { dx: 0, dy: 1, from: "top", to: "bottom" }, // Card below
      { dx: -1, dy: 0, from: "right", to: "left" }, // Card to the left
    ];

    for (const dir of directions) {
      const nx = position.x + dir.dx;
      const ny = position.y + dir.dy;
      if (
        nx >= 0 &&
        nx < BOARD_SIZE &&
        ny >= 0 &&
        ny < BOARD_SIZE &&
        tempBoard[ny][nx] !== null &&
        tempBoard[ny][nx]!.card
      ) {
        const adjacentCell = tempBoard[ny][nx]!;
        if (adjacentCell.card!.owner !== aiPlayerId) {
          const placedCardPower = (cardToPlay.current_power as any)[dir.from];
          const adjacentCardPower = (adjacentCell.card!.current_power as any)[
            dir.to
          ];
          if (placedCardPower > adjacentCardPower) {
            potentialFlips++;
          }
        }
      }
    }
    score += potentialFlips * 100;
    // Add sum of card's current power stats to score
    score +=
      cardToPlay.current_power.top +
      cardToPlay.current_power.right +
      cardToPlay.current_power.bottom +
      cardToPlay.current_power.left;

    // Positional bonus for strategic positions (corners and center have higher value)
    if (
      (position.x === 0 && position.y === 0) || // top-left corner
      (position.x === BOARD_SIZE - 1 && position.y === 0) || // top-right corner
      (position.x === 0 && position.y === BOARD_SIZE - 1) || // bottom-left corner
      (position.x === BOARD_SIZE - 1 && position.y === BOARD_SIZE - 1) // bottom-right corner
    ) {
      score += 50; // Corners are strategically valuable
    }

    return score;
  }

  async makeAIMove(
    currentGameState: GameState,
    aiDifficulty = "medium"
  ): Promise<{
    action_type: string;
    user_card_instance_id: string;
    position: BoardPosition;
  } | null> {
    const aiPlayer = currentGameState.player1.user_id.startsWith("AI_")
      ? currentGameState.player1
      : currentGameState.player2;
    if (aiPlayer.hand.length === 0) return null;

    let possibleMoves = [];
    for (const instanceIdInHand of aiPlayer.hand) {
      // Get hydrated card data for AI (from cache or fetch - AI doesn't need userId verification for its own cards)
      let cardData =
        currentGameState.hydrated_card_data_cache?.[instanceIdInHand];
      if (!cardData) {
        const fetchedCard = await GameLogic.hydrateCardInstance(
          instanceIdInHand
        );
        if (!fetchedCard) continue; // Skip this card if we can't hydrate it
        cardData = fetchedCard;
      }

      for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
          if (currentGameState.board[y][x] === null) {
            const moveScore = this.evaluateMove(
              _.cloneDeep(currentGameState),
              cardData as InGameCard,
              { x, y },
              aiPlayer.user_id
            );
            possibleMoves.push({
              user_card_instance_id: instanceIdInHand,
              position: { x, y },
              score: moveScore,
            });
          }
        }
      }
    }

    if (possibleMoves.length === 0) return null;
    possibleMoves.sort((a, b) => b.score - a.score);
    const topN = Math.min(
      possibleMoves.length,
      aiDifficulty === "hard" ? 1 : aiDifficulty === "medium" ? 3 : 5
    );
    const chosenMove = possibleMoves[Math.floor(Math.random() * topN)];

    return {
      action_type: "placeCard",
      user_card_instance_id: chosenMove.user_card_instance_id,
      position: chosenMove.position,
    };
  }
}
