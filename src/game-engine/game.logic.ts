import {
  GameState,
  BoardPosition,
  CardPower,
  Player,
} from "../types/game.types";
import { InGameCard, TriggerMoment } from "../types/card.types";
import * as _ from "lodash";
import db from "../config/db.config"; // For direct DB access if necessary for hydration
import * as validators from "./game.validators";
import * as gameUtils from "./game.utils";
import { triggerAbilities } from "./game.utils";
import { resetTile, setTileStatus, updateCurrentPower } from "./ability.utils";
import {
  BaseGameEvent,
  batchEvents,
  CardEvent,
  CardPlacedEvent,
  EVENT_TYPES,
} from "./game-events";

import { v4 as uuidv4 } from "uuid";

const BOARD_SIZE = 4;

import { GameStatus, TileEvent, TileStatus } from "../types";
export { GameStatus };

// Note: Game winner is stored in the winner_id column in the database
// rather than as part of the status enum

export class GameLogic {
  // Helper to fetch and cache details for a UserCardInstance
  static async hydrateCardInstance(
    instanceId: string,
    userIdToVerifyOwnership?: string
  ): Promise<InGameCard | undefined> {
    try {
      // In a real app, this might hit a cache first, then DB
      // For now, directly query necessary details joining Cards, UserCardInstances, SpecialAbilities
      const query = `
        SELECT 
          uci.user_card_instance_id, uci.level, uci.xp, 
          c.card_id as base_card_id, c.name, c.rarity, c.image_url, 
          c.power->>'top' as base_power_top, c.power->>'right' as base_power_right, 
          c.power->>'bottom' as base_power_bottom, c.power->>'left' as base_power_left, 
          c.tags, c.special_ability_id,
          sa.name as ability_name, sa.description as ability_description, 
          sa.trigger_moment as ability_trigger, sa.parameters as ability_parameters
        FROM "user_owned_cards" uci
        JOIN "cards" c ON uci.card_id = c.card_id
        LEFT JOIN "special_abilities" sa ON c.special_ability_id = sa.ability_id
        WHERE uci.user_card_instance_id = $1 ${
          userIdToVerifyOwnership ? "AND uci.user_id = $2" : ""
        };
      `;
      const params = userIdToVerifyOwnership
        ? [instanceId, userIdToVerifyOwnership]
        : [instanceId];

      try {
        const { rows } = await db.query(query, params);

        if (rows.length === 0) {
          return undefined;
        }

        const row = rows[0];
        // const levelBonus = row.level - 1; // Example: +1 power per stat for each level above 1
        const levelBonus = 0;

        // Create base power values from the database
        const basePower = {
          top: parseInt(row.base_power_top, 10),
          right: parseInt(row.base_power_right, 10),
          bottom: parseInt(row.base_power_bottom, 10),
          left: parseInt(row.base_power_left, 10),
        };

        // Create a SpecialAbility object if there's an ability
        const specialAbility = row.ability_name
          ? {
              id: row.special_ability_id,
              name: row.ability_name,
              ability_id: row.special_ability_id,
              description: row.ability_description,
              triggerMoment: row.ability_trigger,
              parameters: row.ability_parameters || {},
            }
          : null;

        // Structure the base card data according to BaseCard interface
        const baseCardData = {
          card_id: row.base_card_id,
          name: row.name,
          tags: Array.isArray(row.tags) ? row.tags : [],
          rarity: row.rarity,
          image_url: row.image_url,
          base_power: basePower,
          special_ability: specialAbility,
        };

        // Calculate current power (base + level bonus)
        const currentPower = {
          top: basePower.top + levelBonus,
          right: basePower.right + levelBonus,
          bottom: basePower.bottom + levelBonus,
          left: basePower.left + levelBonus,
        };

        // Empty power enhancements (will be populated elsewhere if needed)
        const powerEnhancements = {
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
        };

        // Create the full InGameCard structure according to the interface
        const result: InGameCard = {
          user_card_instance_id: row.user_card_instance_id,
          base_card_id: row.base_card_id,
          base_card_data: baseCardData,
          level: row.level,
          xp: row.xp,
          power_enhancements: powerEnhancements,
          // InGameCard specific properties
          owner: userIdToVerifyOwnership || "",
          original_owner: userIdToVerifyOwnership || "",
          current_power: currentPower,
          card_modifiers_positive: { top: 0, right: 0, bottom: 0, left: 0 },
          card_modifiers_negative: { top: 0, right: 0, bottom: 0, left: 0 },
          temporary_effects: [],
          lockedTurns: 0,
          defeats: [],
        };

        return result;
      } catch (dbError) {
        console.error(
          `[DEBUG] Database error in hydrateCardInstance: ${
            dbError instanceof Error ? dbError.message : String(dbError)
          }`
        );
        console.error(
          `[DEBUG] Error stack: ${
            dbError instanceof Error ? dbError.stack : "No stack trace"
          }`
        );
        throw dbError;
      }
    } catch (error) {
      console.error(
        `[DEBUG] Unexpected error in hydrateCardInstance: ${
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

    const board = Array(BOARD_SIZE)
      .fill(null)
      .map(() =>
        Array(BOARD_SIZE).fill(
          gameUtils.createBoardCell(null, "normal").boardCell
        )
      );
    const hydrated_card_data_cache: Record<string, InGameCard> = {};

    // Hydrate initial hands and cache them
    const p1HandInstanceIds = p1DeckShuffled.slice(0, initialHandSize);
    for (const id of p1HandInstanceIds) {
      if (!hydrated_card_data_cache[id]) {
        const cardData = await this.hydrateCardInstance(id, player1UserId);
        if (cardData) hydrated_card_data_cache[id] = cardData;
      }
    }
    const p2HandInstanceIds = p2DeckShuffled.slice(0, initialHandSize);
    for (const id of p2HandInstanceIds) {
      if (!hydrated_card_data_cache[id]) {
        // For AI, we don't verify ownership with userId, or AI has its own instances
        const cardData = await this.hydrateCardInstance(
          id,
          player2UserId.startsWith("AI_") ? undefined : player2UserId
        );
        if (cardData) hydrated_card_data_cache[id] = cardData;
      }
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

  static async placeCard(
    currentGameState: GameState,
    playerId: string,
    userCardInstanceId: string, // Now expects the ID of the UserCardInstance
    position: BoardPosition
  ): Promise<{ state: GameState; events: BaseGameEvent[] }> {
    const events: BaseGameEvent[] = [];

    try {
      let newState = _.cloneDeep(currentGameState);
      const cardIndexInHand = validators.getCardIndexInHand(
        newState,
        playerId,
        userCardInstanceId
      );
      const playedCardData =
        newState.hydrated_card_data_cache?.[userCardInstanceId];

      if (!playedCardData) throw new Error(`Card data does not exist`);

      if (!validators.isPlayerTurn(newState, playerId))
        throw new Error("Not player's turn.");
      if (cardIndexInHand === -1) throw new Error("Card instance not in hand.");
      const { canPlace, errorMessage } = validators.canPlaceOnTile(
        newState,
        position
      );
      if (!canPlace) throw new Error(errorMessage);

      // Get player and opponent references
      const player = validators.getPlayer(newState, playerId);

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
        delayAfterMs: 0,
        position,
      } as CardPlacedEvent);

      events.push(
        ...triggerAbilities(TriggerMoment.OnPlace, {
          state: newState,
          triggerCard: newBoardCell.card!,
          position,
        })
      );

      // Resolve combat with adjacent cards
      try {
        const combatResult = gameUtils.resolveCombat(
          newState,
          position,
          playerId
        );
        newState = combatResult.state;
        events.push(...combatResult.events);
      } catch (err) {
        throw err;
      }

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
      console.error(
        `[DEBUG] Error in placeCard: ${
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
    const drawnInstanceId =
      playerId === newState.player1.user_id
        ? newState.player1.deck.shift()!
        : newState.player2.deck.shift()!;

    // Update the correct player's hand and deck in the game state
    if (playerId === newState.player1.user_id) {
      newState.player1.hand.push(drawnInstanceId);
    } else {
      newState.player2.hand.push(drawnInstanceId);
    }

    if (!newState.hydrated_card_data_cache?.[drawnInstanceId]) {
      try {
        const cardData = await this.hydrateCardInstance(
          drawnInstanceId,
          playerId
        );
        if (cardData && newState.hydrated_card_data_cache) {
          newState.hydrated_card_data_cache[drawnInstanceId] = cardData;
        }
        events.push({
          type: EVENT_TYPES.CARD_DRAWN,
          eventId: "TODO",
          timestamp: Date.now(),
          sourcePlayerId: playerId,
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
    newState.turn_number++;

    events.push(...gameUtils.turnEndAbilities(newState));

    events.push({
      type: EVENT_TYPES.TURN_END,
      eventId: uuidv4(),
      delayAfterMs: 500,
      timestamp: Date.now(),
      sourcePlayerId: playerId,
    });

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
