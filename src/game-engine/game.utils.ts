import { GameState, BoardPosition, BoardCell } from "../types/game.types";
import { InGameCard, PowerValues, TriggerMoment } from "../types/card.types";
import { GameStatus } from "./game.logic";
import * as _ from "lodash";
import { abilities } from "./abilities";
import { updateCurrentPower } from "./ability.utils";
import {
  BaseGameEvent,
  batchEvents,
  CardEvent,
  EVENT_TYPES,
} from "./game-events";

/**
 * Creates a new board cell from hydrated card data
 */
export function createBoardCell(
  playedCardData: InGameCard | null,
  playerId: string
): BoardCell {
  const card: InGameCard | null = playedCardData
    ? {
        ...playedCardData,
        owner: playerId,
        temporary_effects: [],
        card_modifiers_positive: { top: 0, right: 0, bottom: 0, left: 0 },
        card_modifiers_negative: { top: 0, right: 0, bottom: 0, left: 0 },
        power_enhancements: { top: 0, bottom: 0, left: 0, right: 0 },
        current_power: { ...playedCardData.base_card_data.base_power },
      }
    : null;

  return {
    card,
    tile_status: "normal",
    turns_left: 0,
    animation_label: null,
  };
}

/**
 * Resolves combat between the placed card and adjacent cards
 */
type CombatResult = {
  state: GameState;
  events: BaseGameEvent[];
};
export function resolveCombat(
  gameState: GameState,
  position: BoardPosition,
  playerId: string
): CombatResult {
  const events: BaseGameEvent[] = [];

  try {
    const newState = _.cloneDeep(gameState);
    const directions: {
      dx: number;
      dy: number;
      from: keyof PowerValues;
      to: keyof PowerValues;
    }[] = [
      { dx: 0, dy: -1, from: "top", to: "bottom" }, // Card above
      { dx: 1, dy: 0, from: "right", to: "left" }, // Card to the right
      { dx: 0, dy: 1, from: "bottom", to: "top" }, // Card below
      { dx: -1, dy: 0, from: "left", to: "right" }, // Card to the left
    ];

    const placedCell = newState.board[position.y][position.x];

    if (!placedCell || !placedCell.card) {
      return { state: newState, events };
    }

    for (const dir of directions) {
      const nx = position.x + dir.dx;
      const ny = position.y + dir.dy;

      if (
        nx >= 0 &&
        nx < newState.board.length && // Assuming BOARD_SIZE is 4
        ny >= 0 &&
        ny < newState.board.length &&
        newState.board[ny][nx] &&
        newState.board[ny][nx]?.card &&
        newState.board[ny][nx]?.tile_status !== "removed"
      ) {
        const adjacentCell = newState.board[ny][nx]!;
        if (!adjacentCell.card) continue;

        if (adjacentCell.card.owner !== playerId) {
          const placedCardPower = placedCell.card.current_power[dir.from];
          const adjacentCardPower = adjacentCell.card.current_power[dir.to];

          if (placedCardPower > adjacentCardPower) {
            events.push(
              ...flipCard(
                newState,
                position,
                adjacentCell.card,
                placedCell.card
              )
            );
          }
        }
      }
    }

    return { state: newState, events };
  } catch (error) {
    console.error(
      `[DEBUG] Error in resolveCombat: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    console.error(
      `[DEBUG] Error stack: ${
        error instanceof Error ? error.stack : "No stack trace"
      }`
    );
    throw error;
  }
}

export function canPlaceOnTile(
  gameState: GameState,
  position: BoardPosition
): boolean {
  const tile = gameState.board[position.y][position.x];
  if (!tile) return false;
  if (tile.card) return false;
  if (tile.tile_status === "blocked" || tile.tile_status === "removed")
    return false;

  return true;
}

export function flipCard(
  state: GameState,
  position: BoardPosition,
  target: InGameCard,
  source: InGameCard
): BaseGameEvent[] {
  if (target.lockedTurns > 0) return [];

  const events: BaseGameEvent[] = [];

  events.push(
    ...triggerAbilities("OnFlip", {
      state,
      triggerCard: source,
      flippedCardId: target.user_card_instance_id,
      position: {
        x: position.x,
        y: position.y,
      },
    })
  );
  target.owner = state.current_player_id;

  const cardFlippedEvent: CardEvent = {
    type: EVENT_TYPES.CARD_FLIPPED,
    eventId: "TODO",
    timestamp: Date.now(),
    sourcePlayerId: state.current_player_id,
    cardId: target.user_card_instance_id,
  };
  events.push(cardFlippedEvent);

  events.push(
    ...triggerAbilities("OnFlipped", {
      state,
      triggerCard: target,
      flippedByCardId: source.user_card_instance_id,
      position,
    })
  );
  return events;
}

export type TriggerContext = {
  state: GameState;
  triggerCard: InGameCard;
  flippedCard?: InGameCard;
  flippedBy?: InGameCard;
  flippedCardId?: string;
  flippedByCardId?: string;
  position: BoardPosition;
};

export function triggerAbilities(
  trigger: TriggerMoment,
  context: TriggerContext
): BaseGameEvent[] {
  const events: BaseGameEvent[] = [];
  const { triggerCard, state } = context;

  // check the specific card
  if (triggerCard.base_card_data.special_ability) {
    const ability = triggerCard.base_card_data.special_ability;
    if (ability.trigger_moment === trigger && abilities[ability.name]) {
      console.log(ability.name);
      events.push(...abilities[ability.name]?.(context));
      updateAllBoardCards(state);
    }
  }

  // Check in-hand triggers
  let playerOrder = [];
  if (state.current_player_id === state.player1.user_id) {
    playerOrder = [state.player1, state.player2];
  } else {
    playerOrder = [state.player2, state.player1];
  }

  for (const player of playerOrder) {
    for (const cardId of player.hand) {
      const card = state.hydrated_card_data_cache?.[cardId];
      if (card && card.base_card_data.special_ability) {
        const ability = card.base_card_data.special_ability;
        if (ability.trigger_moment === `InHand${trigger}`) {
          events.push(...abilities[ability.name]?.(context));
        }
      }
    }
  }

  return batchEvents(events, 100);
}

export function updateAllBoardCards(gameState: GameState) {
  //Update board card's current powers
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const cell = gameState.board[y][x];
      if (!cell?.card) continue;

      cell.card.current_power = updateCurrentPower(cell.card);

      const cachedCard =
        gameState.hydrated_card_data_cache?.[cell.card.user_card_instance_id];
      if (cachedCard) {
        cachedCard.current_power = cell.card.current_power;
      }
    }
  }
}

/**
 * Draws a card from the player's deck to their hand
 */
export function drawCard(gameState: GameState, playerId: string): GameState {
  const newState = _.cloneDeep(gameState);
  const player =
    newState.player1.user_id === playerId ? newState.player1 : newState.player2;

  if (player.deck.length > 0) {
    const drawnInstanceId = player.deck.shift()!;
    player.hand.push(drawnInstanceId);
  }

  return newState;
}

/**
 * Handles game over logic
 */
export function handleGameOver(gameState: GameState): GameState {
  const newState = _.cloneDeep(gameState);

  // Determine winner based on scores
  if (newState.player1.score > newState.player2.score) {
    newState.status = GameStatus.COMPLETED;
    newState.winner = newState.player1.user_id;
  } else if (newState.player2.score > newState.player1.score) {
    newState.status = GameStatus.COMPLETED;
    newState.winner = newState.player2.user_id;
  } else {
    newState.status = GameStatus.COMPLETED;
    newState.winner = null; // Draw
  }

  return newState;
}
