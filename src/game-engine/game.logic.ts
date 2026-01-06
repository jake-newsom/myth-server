import { GameState, BoardPosition, Player } from "../types/game.types";
import { InGameCard, TriggerMoment } from "../types/card.types";
import * as _ from "lodash";
import db from "../config/db.config"; // For direct DB access if necessary for hydration
import * as validators from "./game.validators";
import * as gameUtils from "./game.utils";
import { triggerAbilities } from "./game.utils";
import { resetTile, updateCurrentPower } from "./ability.utils";
import {
  BaseGameEvent,
  batchEvents,
  CardEvent,
  CardPlacedEvent,
  EVENT_TYPES,
} from "./game-events";

import { v4 as uuidv4 } from "uuid";
import PowerUpService from "../services/powerUp.service";
import logger from "../utils/logger";
import { GAME_CONFIG } from "../config/constants";

import { GameStatus } from "../types";
export { GameStatus };

export class GameLogic {
  //Helper to fetch and cache details for multiple UserCardInstances
  static async hydrateCardInstances(
    instanceIds: string[],
    userIdToVerifyOwnership?: string
  ): Promise<Map<string, InGameCard>> {
    const hydratedCards = new Map<string, InGameCard>();

    if (instanceIds.length === 0) {
      return hydratedCards;
    }

    try {
      const placeholders = instanceIds
        .map((_, index) => `$${index + (userIdToVerifyOwnership ? 2 : 1)}`)
        .join(",");
      const query = `
        SELECT 
          uci.user_card_instance_id, uci.level, uci.xp, uci.user_id,
          c.card_id as base_card_id, c.name, c.rarity, c.image_url, 
          c.power->>'top' as base_power_top, c.power->>'right' as base_power_right, 
          c.power->>'bottom' as base_power_bottom, c.power->>'left' as base_power_left, 
          c.tags, c.special_ability_id, c.set_id, c.attack_animation,
          sa.name as ability_name, sa.description as ability_description, 
          sa.trigger_moments as ability_triggers, sa.parameters as ability_parameters
        FROM "user_owned_cards" uci
        JOIN "cards" c ON uci.card_id = c.card_id
        LEFT JOIN "special_abilities" sa ON c.special_ability_id = sa.ability_id
        WHERE uci.user_card_instance_id IN (${placeholders}) ${
        userIdToVerifyOwnership ? "AND uci.user_id = $1" : ""
      };
      `;

      const params = userIdToVerifyOwnership
        ? [userIdToVerifyOwnership, ...instanceIds]
        : instanceIds;

      const { rows } = await db.query(query, params);

      // Get power ups for all instances in batch
      const powerUpsMap = await PowerUpService.getPowerUpsByCardInstances(
        instanceIds
      );

      for (const row of rows) {
        const levelBonus = 0; // Keep consistent with single hydration

        const basePower = {
          top: parseInt(row.base_power_top, 10),
          right: parseInt(row.base_power_right, 10),
          bottom: parseInt(row.base_power_bottom, 10),
          left: parseInt(row.base_power_left, 10),
        };

        // Get power up data for this instance
        const powerUp = powerUpsMap.get(row.user_card_instance_id);
        const powerEnhancements = powerUp?.power_up_data || {
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
        };

        const currentPower = {
          top: basePower.top + levelBonus + powerEnhancements.top,
          right: basePower.right + levelBonus + powerEnhancements.right,
          bottom: basePower.bottom + levelBonus + powerEnhancements.bottom,
          left: basePower.left + levelBonus + powerEnhancements.left,
        };

        const hydratedCard: InGameCard = {
          user_card_instance_id: row.user_card_instance_id,
          base_card_id: row.base_card_id,
          base_card_data: {
            card_id: row.base_card_id,
            name: row.name,
            rarity: row.rarity,
            image_url: row.image_url,
            base_power: basePower,
            set_id: row.set_id,
            tags: row.tags,
            special_ability: row.ability_name
              ? {
                  ability_id: row.special_ability_id,
                  id: row.special_ability_id,
                  name: row.ability_name,
                  description: row.ability_description,
                  triggerMoments:
                    (row.ability_triggers as TriggerMoment[]) || [],
                  parameters: row.ability_parameters,
                }
              : null,
            ...(row.attack_animation && {
              attack_animation: row.attack_animation,
            }),
          },
          level: row.level,
          xp: row.xp,
          power_enhancements: powerEnhancements,
          current_power: currentPower,
          owner: row.user_id,
          original_owner: row.user_id,
          card_modifiers_positive: { top: 0, right: 0, bottom: 0, left: 0 },
          card_modifiers_negative: { top: 0, right: 0, bottom: 0, left: 0 },
          temporary_effects: [],
          lockedTurns: 0,
          defeats: [],
        };

        hydratedCards.set(row.user_card_instance_id, hydratedCard);
      }

      return hydratedCards;
    } catch (error) {
      logger.error(
        "Error in batch hydrateCardInstances",
        {
          instanceIds: instanceIds.length,
          userIdToVerifyOwnership,
        },
        error instanceof Error ? error : new Error(String(error))
      );
      return hydratedCards;
    }
  }

  static async initializeGame(
    player1UserCardInstanceIds: string[], // Array of UserCardInstance IDs
    player2UserCardInstanceIds: string[], // Array of UserCardInstance IDs for AI or P2
    player1UserId: string,
    player2UserId = "00000000-0000-0000-0000-000000000000"
  ): Promise<GameState> {
    const shuffleDeck = (deck: string[]): string[] => _.shuffle(deck);
    const p1DeckShuffled = shuffleDeck([...player1UserCardInstanceIds]);
    const p2DeckShuffled = shuffleDeck([...player2UserCardInstanceIds]);
    const initialHandSize = 5;

    const board = Array(GAME_CONFIG.BOARD_SIZE)
      .fill(null)
      .map(() =>
        Array(GAME_CONFIG.BOARD_SIZE).fill(
          gameUtils.createBoardCell(null, "normal").boardCell
        )
      );
    const hydrated_card_data_cache: Record<string, InGameCard> = {};

    // Hydrate initial hands in batch
    const p1HandInstanceIds = p1DeckShuffled.slice(0, initialHandSize);
    const p2HandInstanceIds = p2DeckShuffled.slice(0, initialHandSize);

    // Batch hydrate all initial hand cards at once for better performance
    const allInitialCardIds = [...p1HandInstanceIds, ...p2HandInstanceIds];
    const p1CardsMap = await this.hydrateCardInstances(
      p1HandInstanceIds,
      player1UserId
    );
    const p2CardsMap = await this.hydrateCardInstances(
      p2HandInstanceIds,
      player2UserId.startsWith("AI_") ? undefined : player2UserId
    );

    // Populate cache with hydrated cards
    for (const [id, cardData] of p1CardsMap.entries()) {
      hydrated_card_data_cache[id] = cardData;
    }
    for (const [id, cardData] of p2CardsMap.entries()) {
      hydrated_card_data_cache[id] = cardData;
    }

    const player1: Player = {
      user_id: player1UserId,
      hand: p1HandInstanceIds,
      deck: p1DeckShuffled.slice(initialHandSize),
      discard_pile: [],
      score: 0,
    };

    const player2: Player = {
      user_id: player2UserId,
      hand: p2HandInstanceIds,
      deck: p2DeckShuffled.slice(initialHandSize),
      discard_pile: [],
      score: 0,
    };

    return {
      board,
      player1,
      player2,
      current_player_id: player1UserId,
      turn_number: 1,
      status: GameStatus.ACTIVE,
      max_cards_in_hand: 10,
      initial_cards_to_draw: initialHandSize,
      hydrated_card_data_cache,
      winner: null, // Initialize with no winner
    };
  }

  /**
   * Validates current players turn, current player owns the card, card is in their hand, and the card can be placed
   * on the tile they chose. If all passes, card placed on tile, transfers any tile effects it should, resolves
   * combat and returns game state + array of events.
   *
   * @param currentGameState
   * @param playerId
   * @param userCardInstanceId
   * @param position
   * @returns
   */
  static async placeCard(
    currentGameState: GameState,
    playerId: string,
    userCardInstanceId: string, // Now expects the ID of the UserCardInstance
    position: BoardPosition
  ): Promise<{ state: GameState; events: BaseGameEvent[] }> {
    const events: BaseGameEvent[] = [];

    try {
      let newState = _.cloneDeep(currentGameState);
      const player = validators.getPlayer(newState, playerId);

      if (!validators.isPlayerTurn(newState, playerId))
        throw new Error("not player's turn.");

      const cardIndexInHand = validators.getCardIndexInHand(
        newState,
        playerId,
        userCardInstanceId
      );
      const playedCardData =
        newState.hydrated_card_data_cache?.[userCardInstanceId];
      if (!playedCardData) throw new Error(`Card data does not exist`);
      if (playedCardData.owner !== player.user_id)
        throw new Error(`card does not belong to player`);
      if (cardIndexInHand === -1) throw new Error(`card not in player's hand`);

      const { canPlace, errorMessage } = validators.canPlaceOnTile(
        newState,
        position
      );
      if (!canPlace) throw new Error(errorMessage);

      // Get existing tile effect before placing the card
      const existingTileEffect =
        newState.board[position.y][position.x]?.tile_effect;

      const { boardCell: newBoardCell, tileEffectTransferred } =
        gameUtils.createBoardCell(playedCardData, playerId, existingTileEffect);
      player.hand.splice(cardIndexInHand, 1);

      if (tileEffectTransferred) {
        events.push({
          type: EVENT_TYPES.CARD_POWER_CHANGED,
          eventId: uuidv4(),
          timestamp: Date.now(),
          position,
        } as CardEvent);
      }

      newState.board[position.y][position.x] = newBoardCell;
      events.push({
        type: EVENT_TYPES.CARD_PLACED,
        eventId: uuidv4(),
        timestamp: Date.now(),
        cardId: playedCardData.user_card_instance_id,
        originalOwner: playedCardData.owner,
        delayAfterMs: 500,
        position,
      } as CardPlacedEvent);

      events.push(
        ...triggerAbilities(TriggerMoment.OnPlace, {
          state: newState,
          triggerCard: newBoardCell.card!,
          triggerMoment: TriggerMoment.OnPlace,
          position,
        })
      );

      // Resolve combat with adjacent cards
      const combatResult = gameUtils.resolveCombat(
        newState,
        position,
        playerId
      );
      newState = combatResult.state;
      events.push(...combatResult.events);

      const scores = validators.calculateScores(
        newState.board,
        newState.player1.user_id,
        newState.player2.user_id
      );
      newState.player1.score = scores.player1Score;
      newState.player2.score = scores.player2Score;

      if (validators.shouldDrawCard(player, newState.max_cards_in_hand)) {
        const drawCardResult = await this.drawCard(newState, playerId);
        newState = drawCardResult.state;
        events.push(...drawCardResult.events);
      }

      if (validators.isBoardFull(newState.board)) {
        // Move all cards to discard piles and determine winner
        const winnerId = validators.determineGameOutcome(
          newState.player1.score,
          newState.player2.score,
          newState.player1.user_id,
          newState.player2.user_id
        );

        newState.status = GameStatus.COMPLETED;
        newState.winner = winnerId;
      } else {
        // Switch turn to opponent

        const endTurnResult = await GameLogic.endTurn(newState, playerId);
        newState = endTurnResult.state;
        events.push(...endTurnResult.events);
      }

      return { state: newState, events };
    } catch (error) {
      logger.error(
        "Error in placeCard",
        {
          playerId,
          position: position ? `${position.x},${position.y}` : "unknown",
          userCardInstanceId,
        },
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }

  /**
   * Draws a card from the specified player's deck and adds it to their hand.
   * Also hydrates the card data if not already cached.
   */
  static async drawCard(
    currentGameState: GameState,
    playerId: string
  ): Promise<{ state: GameState; events: BaseGameEvent[] }> {
    const events: BaseGameEvent[] = [];
    const newState = _.cloneDeep(currentGameState);

    // Get the drawn card from the correct player's deck in the game state
    const player = validators.getPlayer(newState, playerId);
    const drawnInstanceId = player.deck.shift()!;
    player.hand.push(drawnInstanceId);

    if (!newState.hydrated_card_data_cache?.[drawnInstanceId]) {
      try {
        const cardData = (
          await this.hydrateCardInstances([drawnInstanceId], player.user_id)
        ).get(drawnInstanceId);
        if (cardData && newState.hydrated_card_data_cache) {
          newState.hydrated_card_data_cache[drawnInstanceId] = cardData;
        }
        events.push({
          type: EVENT_TYPES.CARD_DRAWN,
          eventId: uuidv4(),
          timestamp: Date.now(),
          sourcePlayerId: player.user_id,
          cardId: drawnInstanceId,
        } as CardEvent);
      } catch (err) {
        console.error(
          `[DEBUG] Error during drawn card hydration: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
        // Continue even if this fails, it's not critical
      }
    }

    return { state: newState, events: batchEvents(events, 50) };
  }

  static async discardCard(
    currentGameState: GameState,
    playerId: string,
    cardIndex: number | null = null
  ): Promise<{ state: GameState; events: BaseGameEvent[] }> {
    const events: BaseGameEvent[] = [];
    const newState = _.cloneDeep(currentGameState);
    const player = validators.getPlayer(newState, playerId);

    if (cardIndex === null) {
      cardIndex = _.random(0, player.hand.length - 1);
    }

    player.discard_pile.push(player.hand[cardIndex]);
    player.hand.splice(cardIndex, 1);

    return { state: newState, events: batchEvents(events, 50) };
  }

  // Additional methods like endTurn, surrender, etc. can be implemented here
  static async endTurn(
    currentGameState: GameState,
    playerId: string
  ): Promise<{ state: GameState; events: BaseGameEvent[] }> {
    if (!validators.isPlayerTurn(currentGameState, playerId)) {
      throw new Error("Not current player's turn to end.");
    }

    let events: BaseGameEvent[] = [];

    const newState = _.cloneDeep(currentGameState);

    // Process temporary effects
    for (const [y, row] of newState.board.entries()) {
      for (const [x, cell] of row.entries()) {
        if (cell.tile_effect?.turns_left && cell.tile_effect.turns_left > 0) {
          cell.tile_effect.turns_left -= 1;

          if (cell.tile_effect.turns_left === 0) {
            events.push(resetTile(cell, { x, y }));
          }
        }
        if (cell?.card) {
          cell.card.temporary_effects = cell.card.temporary_effects.filter(
            (effect) => {
              effect.duration -= 1;
              return effect.duration > 0;
            }
          );
          cell.card.current_power = updateCurrentPower(cell.card);
          if (newState.hydrated_card_data_cache) {
            newState.hydrated_card_data_cache[cell.card.user_card_instance_id] =
              cell.card;
          }
        }
      }
    }

    events = batchEvents(events, 300);

    // Switch turns
    newState.current_player_id =
      newState.current_player_id === newState.player1.user_id
        ? newState.player2.user_id
        : newState.player1.user_id;

    events.push(
      ...gameUtils.triggerIndirectAbilities(TriggerMoment.OnTurnEnd, {
        state: newState,
        triggerMoment: TriggerMoment.OnTurnEnd,
        position: { x: 0, y: 0 },
      })
    );

    events.push({
      type: EVENT_TYPES.TURN_END,
      eventId: uuidv4(),
      delayAfterMs: 500,
      timestamp: Date.now(),
      sourcePlayerId: playerId,
    });

    if (newState.turn_number % 2 === 0) {
      events.push(
        ...gameUtils.triggerAbilities(TriggerMoment.OnRoundEnd, {
          state: newState,
          triggerMoment: TriggerMoment.OnRoundEnd,
          position: { x: 0, y: 0 },
        })
      );
      events.push(
        ...gameUtils.triggerAbilities(TriggerMoment.OnRoundStart, {
          state: newState,
          triggerMoment: TriggerMoment.OnRoundStart,
          position: { x: 0, y: 0 },
        })
      );
    }

    newState.turn_number++;

    return { state: newState, events };
  }

  static async surrender(
    currentGameState: GameState,
    playerId: string
  ): Promise<GameState> {
    let newState = _.cloneDeep(currentGameState);

    // Set winner to the opponent of the player who surrendered
    newState.status = GameStatus.COMPLETED;
    newState.winner =
      playerId === newState.player1.user_id
        ? newState.player2.user_id
        : newState.player1.user_id;

    return newState;
  }
}
