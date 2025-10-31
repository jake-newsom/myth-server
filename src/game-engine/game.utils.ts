import {
  GameState,
  BoardPosition,
  BoardCell,
  TileEffect,
} from "../types/game.types";
import {
  EffectType,
  InGameCard,
  PowerValues,
  TriggerMoment,
} from "../types/card.types";
import { GameStatus, GameLogic } from "./game.logic";
import * as _ from "lodash";
import { abilities, combatResolvers } from "./abilities";
import {
  BaseGameEvent,
  CardEvent,
  EVENT_TYPES,
  TriggerContext,
  COMBAT_TYPES,
} from "../types/game-engine.types";
import { v4 as uuidv4 } from "uuid";
import {
  getPositionOfCardById,
  updateCurrentPower,
  transferTileEffectToCard,
} from "./ability.utils";
import { batchEvents } from "./game-events";

/**
 * Creates a new board cell from hydrated card data, transferring tile effects to card if present
 */
export function createBoardCell(
  playedCardData: InGameCard | null,
  playerId: string,
  existingTileEffect?: TileEffect
): { boardCell: BoardCell; tileEffectTransferred: boolean } {
  let tileEffectTransferred = false;

  const card: InGameCard | null = playedCardData
    ? {
        ...playedCardData,
        owner: playerId,
        temporary_effects: [],
        card_modifiers_positive: { top: 0, right: 0, bottom: 0, left: 0 },
        card_modifiers_negative: { top: 0, right: 0, bottom: 0, left: 0 },
        // Preserve the power_enhancements from the hydrated card data (includes power-ups)
        power_enhancements: playedCardData.power_enhancements,
        current_power: { ...playedCardData.base_card_data.base_power },
      }
    : null;

  // Transfer tile effect to card if present and applicable
  if (card && existingTileEffect) {
    tileEffectTransferred = transferTileEffectToCard(card, existingTileEffect);
  }

  // Recalculate power after potential tile effect transfer
  if (card) {
    card.current_power = updateCurrentPower(card);
  }

  const boardCell: BoardCell = {
    card,
    tile_enabled: true,
    tile_effect: undefined,
  };

  return { boardCell, tileEffectTransferred };
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

    if (placedCell.card)
      events.push(
        ...triggerAbilities(TriggerMoment.BeforeCombat, {
          state: newState,
          triggerCard: placedCell.card,
          position,
        })
      );

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
        newState.board[ny][nx]?.tile_enabled === true
      ) {
        const adjacentCell = newState.board[ny][nx]!;
        if (!adjacentCell.card) continue;

        if (adjacentCell.card.owner !== playerId) {
          const placedCardPower = placedCell.card.current_power[dir.from];
          const adjacentCardPower = adjacentCell.card.current_power[dir.to];

          let abilityPreventedDefeat = false;
          if (
            adjacentCell.card.base_card_data.special_ability?.triggerMoment ===
            TriggerMoment.OnCombat
          ) {
            const combatContext = {
              triggerCard: adjacentCell.card,
              position: { x: nx, y: ny },
              state: newState,
              combatType: COMBAT_TYPES.STANDARD,
            };

            const abilityFunction =
              combatResolvers[
                adjacentCell.card.base_card_data.special_ability?.name
              ];
            if (abilityFunction) {
              abilityPreventedDefeat = abilityFunction({
                ...combatContext,
                triggerCard: adjacentCell.card,
                position: { x: nx, y: ny },
                combatType: COMBAT_TYPES.STANDARD,
              });
            }
          }

          if (!abilityPreventedDefeat && placedCardPower > adjacentCardPower) {
            events.push(
              ...flipCard(
                newState,
                position,
                adjacentCell.card,
                placedCell.card
              )
            );
          } else {
            events.push({
              type: EVENT_TYPES.CARD_DEFENDED,
              eventId: uuidv4(),
              timestamp: Date.now(),
              sourcePlayerId: playerId,
              cardId: adjacentCell.card.user_card_instance_id,
              position: {
                x: nx,
                y: ny,
              },
              animation: "defend",
            } as CardEvent);

            events.push(
              ...triggerAbilities(TriggerMoment.OnDefend, {
                state: newState,
                triggerCard: adjacentCell.card,
                flippedCard: adjacentCell.card,
                flippedBy: placedCell.card,
                position,
              })
            );
          }
        }
      }
    }

    if (placedCell.card)
      events.push(
        ...triggerAbilities(TriggerMoment.AfterCombat, {
          state: newState,
          triggerCard: placedCell.card,
          position,
        })
      );

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

export function flipCard(
  state: GameState,
  position: BoardPosition,
  target: InGameCard,
  source: InGameCard
): BaseGameEvent[] {
  /**
   * Check various ways a card could be protected from defeat.
   */
  if (target.lockedTurns > 0) return [];
  if (
    target.temporary_effects.find(
      (effect) => effect.type === EffectType.BlockDefeat
    )
  )
    return [];

  const events: BaseGameEvent[] = [];

  events.push(
    ...triggerAbilities(TriggerMoment.OnFlip, {
      state,
      triggerCard: source,
      flippedCardId: target.user_card_instance_id,
      position,
    })
  );
  target.owner = state.current_player_id;
  target.defeats.push({
    user_card_instance_id: source.user_card_instance_id,
    base_card_id: source.base_card_id,
    name: source.base_card_data.name,
  });

  const targetPosition = getPositionOfCardById(
    target.user_card_instance_id,
    state.board
  );
  if (!targetPosition) return events;

  const cardFlippedEvent: CardEvent = {
    type: EVENT_TYPES.CARD_FLIPPED,
    eventId: "TODO",
    timestamp: Date.now(),
    sourcePlayerId: state.current_player_id,
    cardId: target.user_card_instance_id,
    position: targetPosition,
  };
  events.push(cardFlippedEvent);

  events.push(
    ...triggerAbilities(TriggerMoment.OnFlipped, {
      state,
      triggerCard: target,
      flippedBy: source,
      position: targetPosition,
    })
  );
  return events;
}

export function turnEndAbilities(state: GameState): BaseGameEvent[] {
  const events: BaseGameEvent[] = [];

  for (let y = 0; y < state.board.length; y++) {
    for (let x = 0; x < state.board[y].length; x++) {
      const cell = state.board[y][x];
      if (cell.card && cell.card.base_card_data.special_ability) {
        const ability = cell.card.base_card_data.special_ability;
        if (ability.triggerMoment === TriggerMoment.OnTurnEnd) {
          events.push(
            ...triggerAbilities(TriggerMoment.OnTurnEnd, {
              state,
              triggerCard: cell.card,
              position: { x, y },
            })
          );
        }
      }
    }
  }

  return events;
}

export function triggerAbilities(
  trigger: TriggerMoment,
  context: TriggerContext
): BaseGameEvent[] {
  const events: BaseGameEvent[] = [];
  const { triggerCard, state } = context;

  // check the specific card
  if (triggerCard.base_card_data.special_ability) {
    const ability = triggerCard.base_card_data.special_ability;
    if (ability.triggerMoment === trigger && abilities[ability.name]) {
      events.push(...abilities[ability.name]?.(context));
      updateAllBoardCards(state);
    }
  }

  let playerOrder = [];
  if (state.current_player_id === state.player1.user_id) {
    playerOrder = [state.player1, state.player2];
  } else {
    playerOrder = [state.player2, state.player1];
  }

  // Check in-hand variants
  for (const player of playerOrder) {
    for (const cardId of player.hand) {
      const card = state.hydrated_card_data_cache?.[cardId];
      if (card && card.base_card_data.special_ability) {
        const ability = card.base_card_data.special_ability;
        if (ability.triggerMoment === `Hand${trigger}`) {
          events.push(...abilities[ability.name]?.(context));
        }
      }
    }
  }

  // Check for "Any" variants
  for (const row of state.board) {
    for (const cell of row) {
      if (cell.card && cell.card.base_card_data.special_ability) {
        const ability = cell.card.base_card_data.special_ability;
        if (ability.triggerMoment === `Any${trigger}`) {
          context;
          events.push(
            ...abilities[ability.name]?.({ ...context, triggerCard: cell.card })
          );
        }
      }
    }
  }

  // for (const player of playerOrder) {
  //   for (const cardId of player.hand) {
  //     const card = state.hydrated_card_data_cache?.[cardId];
  //     if (card && card.base_card_data.special_ability) {
  //       const ability = card.base_card_data.special_ability;
  //       if (ability.triggerMoment === `Any${trigger}`) {
  //         events.push(...abilities[ability.name]?.(context));
  //       }
  //     }
  //   }
  // }

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

/**
 * Synchronous version of drawCard for use in abilities.
 * Only handles state modification, not card hydration.
 * Returns events to indicate card was drawn.
 * NOTE: Cards drawn via this function need to be hydrated separately
 * using hydrateGameStateCards() before sending to client.
 */
export function drawCardSync(
  gameState: GameState,
  playerId: string
): BaseGameEvent[] {
  const events: BaseGameEvent[] = [];

  // Get the player's deck and hand
  const player =
    gameState.player1.user_id === playerId
      ? gameState.player1
      : gameState.player2;

  // Check if player can draw a card
  if (
    player.deck.length === 0 ||
    player.hand.length >= gameState.max_cards_in_hand
  ) {
    return events; // Cannot draw
  }

  // Draw the card
  const drawnInstanceId = player.deck.shift()!;
  player.hand.push(drawnInstanceId);

  // Create draw event
  events.push({
    type: EVENT_TYPES.CARD_DRAWN,
    eventId: uuidv4(),
    timestamp: Date.now(),
    sourcePlayerId: playerId,
    cardId: drawnInstanceId,
  } as CardEvent);

  return events;
}

export function discardCardSync(
  gameState: GameState,
  playerId: string,
  cardIndex: number | null = null
): BaseGameEvent[] {
  const events: BaseGameEvent[] = [];
  const player =
    gameState.player1.user_id === playerId
      ? gameState.player1
      : gameState.player2;

  if (cardIndex === null) {
    cardIndex = _.random(0, player.hand.length - 1);
  }

  if (cardIndex < 0 || cardIndex >= player.hand.length) {
    return events; // Invalid index
  }

  const discardedCardId = player.hand.splice(cardIndex, 1)[0];
  player.discard_pile.push(discardedCardId);

  events.push({
    type: EVENT_TYPES.CARD_DISCARDED,
    eventId: uuidv4(),
    timestamp: Date.now(),
    sourcePlayerId: playerId,
    cardId: discardedCardId,
  } as CardEvent);

  return events;
}

/**
 * Hydrates any missing cards in the game state's hydrated_card_data_cache.
 * This should be called after abilities that use drawCardSync to ensure
 * all cards in hands are available for the frontend to display.
 */
export async function hydrateGameStateCards(
  gameState: GameState
): Promise<void> {
  if (!gameState.hydrated_card_data_cache) {
    gameState.hydrated_card_data_cache = {};
  }

  const missingCardIds = new Set<string>();

  // Check player1's hand for missing cards
  for (const cardId of gameState.player1.hand) {
    if (!gameState.hydrated_card_data_cache[cardId]) {
      missingCardIds.add(cardId);
    }
  }

  // Check player2's hand for missing cards
  for (const cardId of gameState.player2.hand) {
    if (!gameState.hydrated_card_data_cache[cardId]) {
      missingCardIds.add(cardId);
    }
  }

  // Check board cards for missing cards
  for (const row of gameState.board) {
    for (const cell of row) {
      if (cell.card && cell.card.user_card_instance_id) {
        const cardId = cell.card.user_card_instance_id;
        if (!gameState.hydrated_card_data_cache[cardId]) {
          missingCardIds.add(cardId);
        }
      }
    }
  }

  // Hydrate all missing cards
  const hydrationPromises = Array.from(missingCardIds).map(async (cardId) => {
    try {
      const cardData = await GameLogic.hydrateCardInstance(cardId);
      if (cardData) {
        gameState.hydrated_card_data_cache![cardId] = cardData;
      }
    } catch (error) {
      console.error(`Failed to hydrate card ${cardId}:`, error);
    }
  });

  await Promise.all(hydrationPromises);
}
