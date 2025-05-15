import CardModel from "../models/card.model"; // To fetch UserCardInstance details
import {
  GameState,
  BoardPosition,
  CardPower,
  BoardCell,
  Player,
  HydratedCardInstance,
} from "../types/game.types";
import {
  Card as BaseCard,
  UserCardInstance,
  SpecialAbility,
} from "../types/database.types"; // DB Types
import * as _ from "lodash";
import db from "../config/db.config"; // For direct DB access if necessary for hydration

const BOARD_SIZE = 4;

export class GameLogic {
  // Helper to fetch and cache details for a UserCardInstance
  static async hydrateCardInstance(
    instanceId: string,
    userIdToVerifyOwnership?: string
  ): Promise<HydratedCardInstance | null> {
    // In a real app, this might hit a cache first, then DB
    // For now, directly query necessary details joining Cards, UserCardInstances, SpecialAbilities
    const query = `
      SELECT 
        uci.user_card_instance_id, uci.level, uci.xp, 
        c.card_id as base_card_id, c.name, c.rarity, c.image_url, 
        c.power_top as base_power_top, c.power_right as base_power_right, 
        c.power_bottom as base_power_bottom, c.power_left as base_power_left, 
        c.tags, c.special_ability_id,
        sa.name as ability_name, sa.description as ability_description, 
        sa.trigger_moment as ability_trigger, sa.parameters as ability_parameters
      FROM "UserCardInstances" uci
      JOIN "Cards" c ON uci.card_id = c.card_id
      LEFT JOIN "SpecialAbilities" sa ON c.special_ability_id = sa.ability_id
      WHERE uci.user_card_instance_id = $1 ${
        userIdToVerifyOwnership ? "AND uci.user_id = $2" : ""
      };
    `;
    const params = userIdToVerifyOwnership
      ? [instanceId, userIdToVerifyOwnership]
      : [instanceId];
    const { rows } = await db.query(query, params);
    if (rows.length === 0) return null;

    const row = rows[0];
    const levelBonus = row.level - 1; // Example: +1 power per stat for each level above 1
    const basePower: CardPower = {
      top: row.base_power_top,
      right: row.base_power_right,
      bottom: row.base_power_bottom,
      left: row.base_power_left,
    };
    const currentPower: CardPower = {
      top: basePower.top + levelBonus,
      right: basePower.right + levelBonus,
      bottom: basePower.bottom + levelBonus,
      left: basePower.left + levelBonus,
    };

    return {
      user_card_instance_id: row.user_card_instance_id,
      base_card_id: row.base_card_id,
      name: row.name,
      rarity: row.rarity,
      image_url: row.image_url,
      currentPower: currentPower,
      basePower: basePower,
      level: row.level,
      xp: row.xp,
      tags: row.tags,
      special_ability_id: row.special_ability_id,
      ability_name: row.ability_name,
      ability_description: row.ability_description,
      ability_triggerMoment: row.ability_trigger,
      ability_parameters: row.ability_parameters,
    };
  }

  static async initializeGame(
    player1UserCardInstanceIds: string[], // Array of UserCardInstance IDs
    player2UserCardInstanceIds: string[], // Array of UserCardInstance IDs for AI or P2
    player1UserId: string,
    player2UserId = "AI_PLAYER_ID_STATIC_STRING"
  ): Promise<GameState> {
    const shuffleDeck = (deck: string[]): string[] => _.shuffle(deck);
    const p1DeckShuffled = shuffleDeck([...player1UserCardInstanceIds]);
    const p2DeckShuffled = shuffleDeck([...player2UserCardInstanceIds]);
    const initialHandSize = 5;

    const board = Array(BOARD_SIZE)
      .fill(null)
      .map(() => Array(BOARD_SIZE).fill(null));
    const hydratedCardDataCache: Record<string, HydratedCardInstance> = {};

    // Hydrate initial hands and cache them
    const p1HandInstanceIds = p1DeckShuffled.slice(0, initialHandSize);
    for (const id of p1HandInstanceIds) {
      if (!hydratedCardDataCache[id]) {
        const cardData = await this.hydrateCardInstance(id, player1UserId);
        if (cardData) hydratedCardDataCache[id] = cardData;
      }
    }
    const p2HandInstanceIds = p2DeckShuffled.slice(0, initialHandSize);
    for (const id of p2HandInstanceIds) {
      if (!hydratedCardDataCache[id]) {
        // For AI, we don't verify ownership with userId, or AI has its own instances
        const cardData = await this.hydrateCardInstance(
          id,
          player2UserId.startsWith("AI_") ? undefined : player2UserId
        );
        if (cardData) hydratedCardDataCache[id] = cardData;
      }
    }

    const player1: Player = {
      userId: player1UserId,
      hand: p1HandInstanceIds,
      deck: p1DeckShuffled.slice(initialHandSize),
      score: 0,
    };

    const player2: Player = {
      userId: player2UserId,
      hand: p2HandInstanceIds,
      deck: p2DeckShuffled.slice(initialHandSize),
      score: 0,
    };

    return {
      board,
      player1,
      player2,
      currentPlayerId: player1UserId,
      turnNumber: 1,
      status: "active",
      maxCardsInHand: 5,
      initialCardsToDraw: initialHandSize,
      hydratedCardDataCache,
    };
  }

  static async placeCard(
    currentGameState: GameState,
    playerId: string,
    userCardInstanceId: string, // Now expects the ID of the UserCardInstance
    position: BoardPosition
  ): Promise<GameState> {
    let newState = _.cloneDeep(currentGameState);
    const player =
      newState.player1.userId === playerId
        ? newState.player1
        : newState.player2;
    const opponent =
      newState.player1.userId === playerId
        ? newState.player2
        : newState.player1;

    // ... (validation: is it player's turn, is position valid and empty)
    if (newState.currentPlayerId !== playerId)
      throw new Error("Not player's turn.");
    if (
      position.x < 0 ||
      position.x >= BOARD_SIZE ||
      position.y < 0 ||
      position.y >= BOARD_SIZE ||
      newState.board[position.y][position.x] !== null
    ) {
      throw new Error("Invalid board position or position already occupied.");
    }

    const cardIndexInHand = player.hand.indexOf(userCardInstanceId);
    if (cardIndexInHand === -1) throw new Error("Card instance not in hand.");

    // Get hydrated card data (from cache or fetch)
    let playedCardData = newState.hydratedCardDataCache?.[userCardInstanceId];
    if (!playedCardData) {
      playedCardData = await this.hydrateCardInstance(
        userCardInstanceId,
        playerId
      );
      if (!playedCardData)
        throw new Error(
          `Could not retrieve details for card instance ${userCardInstanceId}`
        );
      if (newState.hydratedCardDataCache)
        newState.hydratedCardDataCache[userCardInstanceId] = playedCardData;
    }

    // Place card on board
    const newBoardCell: BoardCell = {
      user_card_instance_id: playedCardData.user_card_instance_id,
      base_card_id: playedCardData.base_card_id,
      owner: playerId,
      currentPower: playedCardData.currentPower, // Use the instance's current (leveled) power
      level: playedCardData.level,
      state: "normal",
      baseCardData: {
        name: playedCardData.name,
        rarity: playedCardData.rarity,
        image_url: playedCardData.image_url,
        special_ability_id: playedCardData.special_ability_id,
        tags: playedCardData.tags,
        basePower: playedCardData.basePower,
        ability_name: playedCardData.ability_name,
        ability_description: playedCardData.ability_description,
        ability_triggerMoment: playedCardData.ability_triggerMoment,
        ability_parameters: playedCardData.ability_parameters,
      },
    };
    newState.board[position.y][position.x] = newBoardCell;
    player.hand.splice(cardIndexInHand, 1);

    // TODO: Trigger OnPlace abilities using newBoardCell and playedCardData
    // newState = AbilityRegistry.executeAbility('OnPlace', newState, position, playerId);

    // Combat resolution (uses newBoardCell.currentPower)
    // ... (combat logic remains similar but uses currentPower from BoardCell)
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
        newState.board[ny][nx]
      ) {
        const adjacentCell = newState.board[ny][nx]!;
        if (adjacentCell.owner !== playerId) {
          // Opponent's card
          const placedCardPower = (newBoardCell.currentPower as any)[dir.from];
          const adjacentCardPower = (adjacentCell.currentPower as any)[dir.to];

          if (placedCardPower > adjacentCardPower) {
            adjacentCell.owner = playerId; // Flip card
            // TODO: Trigger OnFlip (for the flipped card) and OnFlipped (for other cards observing)
            // newState = AbilityRegistry.executeAbility('OnFlip', newState, {x: nx, y: ny}, playerId);
          }
        }
      }
    }

    // Update scores
    newState.player1.score = 0;
    newState.player2.score = 0;
    for (let y = 0; y < BOARD_SIZE; y++) {
      for (let x = 0; x < BOARD_SIZE; x++) {
        if (newState.board[y][x]) {
          if (newState.board[y][x]!.owner === newState.player1.userId)
            newState.player1.score++;
          else if (newState.board[y][x]!.owner === newState.player2.userId)
            newState.player2.score++;
        }
      }
    }

    // Draw card if hand < max and deck has cards
    if (
      player.hand.length < newState.maxCardsInHand &&
      player.deck.length > 0
    ) {
      const drawnInstanceId = player.deck.shift()!;
      player.hand.push(drawnInstanceId);
      // Hydrate and cache the newly drawn card if not already in cache
      if (!newState.hydratedCardDataCache?.[drawnInstanceId]) {
        const cardData = await this.hydrateCardInstance(
          drawnInstanceId,
          playerId
        );
        if (cardData && newState.hydratedCardDataCache)
          newState.hydratedCardDataCache[drawnInstanceId] = cardData;
      }
    }

    // Check game over (board full)
    let boardFull = true;
    for (let y = 0; y < BOARD_SIZE; y++) {
      for (let x = 0; x < BOARD_SIZE; x++) {
        if (newState.board[y][x] === null) {
          boardFull = false;
          break;
        }
      }
      if (!boardFull) break;
    }

    if (boardFull) {
      newState.status =
        newState.player1.score > newState.player2.score
          ? "player1_win"
          : newState.player2.score > newState.player1.score
          ? "player2_win"
          : "draw";
      newState.winner =
        newState.status === "player1_win"
          ? newState.player1.userId
          : newState.status === "player2_win"
          ? newState.player2.userId
          : null;
    } else {
      newState.currentPlayerId = opponent.userId; // Switch turn
      newState.turnNumber++;
    }

    return newState;
  }

  // Additional methods like endTurn, surrender, etc. can be implemented here
  static async endTurn(
    currentGameState: GameState,
    playerId: string
  ): Promise<GameState> {
    let newState = _.cloneDeep(currentGameState);

    if (newState.currentPlayerId !== playerId) {
      throw new Error("Not player's turn.");
    }

    const player =
      newState.player1.userId === playerId
        ? newState.player1
        : newState.player2;
    const opponent =
      newState.player1.userId === playerId
        ? newState.player2
        : newState.player1;

    // Switch turns
    newState.currentPlayerId = opponent.userId;
    newState.turnNumber++;

    return newState;
  }

  static async surrender(
    currentGameState: GameState,
    playerId: string
  ): Promise<GameState> {
    let newState = _.cloneDeep(currentGameState);

    // Determine winner based on who surrendered
    if (playerId === newState.player1.userId) {
      newState.status = "player2_win";
      newState.winner = newState.player2.userId;
    } else {
      newState.status = "player1_win";
      newState.winner = newState.player1.userId;
    }

    return newState;
  }
}
