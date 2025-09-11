import { GameState, BoardPosition, AbilityEffect } from "../types/game.types";
import * as _ from "lodash";

type AbilityHandler = (
  gameState: GameState,
  position: BoardPosition,
  playerId: string,
  parameters?: Record<string, any>
) => GameState;

export class AbilityRegistry {
  private static abilities: Record<string, AbilityHandler> = {};

  // Register ability handlers
  static initialize() {
    // Initialize with basic abilities
    this.registerAbility("DrawCard", this.drawCardAbility);
    this.registerAbility("IncreaseCardPower", this.increaseCardPowerAbility);
    this.registerAbility("SwapCards", this.swapCardsAbility);
    this.registerAbility("RevealEnemyHand", this.revealEnemyHandAbility);
    // Add more abilities as needed
  }

  static registerAbility(abilityId: string, handler: AbilityHandler) {
    this.abilities[abilityId] = handler;
  }

  static executeAbility(
    abilityId: string,
    gameState: GameState,
    position: BoardPosition,
    playerId: string,
    parameters?: Record<string, any>
  ): GameState {
    if (!this.abilities[abilityId]) {
      console.warn(`Ability ${abilityId} not found in registry.`);
      return gameState;
    }

    try {
      return this.abilities[abilityId](
        gameState,
        position,
        playerId,
        parameters
      );
    } catch (error) {
      console.error(`Error executing ability ${abilityId}:`, error);
      return gameState;
    }
  }

  // Example ability implementations
  private static drawCardAbility(
    gameState: GameState,
    position: BoardPosition,
    playerId: string,
    parameters?: Record<string, any>
  ): GameState {
    const newState = _.cloneDeep(gameState);
    const player =
      newState.player1.user_id === playerId
        ? newState.player1
        : newState.player2;

    if (
      player.deck.length > 0 &&
      player.hand.length < newState.max_cards_in_hand
    ) {
      const cardId = player.deck.shift()!;
      player.hand.push(cardId);
    }

    return newState;
  }

  private static increaseCardPowerAbility(
    gameState: GameState,
    position: BoardPosition,
    playerId: string,
    parameters?: Record<string, any>
  ): GameState {
    const newState = _.cloneDeep(gameState);
    const amount = parameters?.amount || 1;

    const cell = newState.board[position.y][position.x];
    if (
      cell &&
      cell.card &&
      cell.card.owner === playerId &&
      cell.card.current_power
    ) {
      cell.card.current_power.top += amount;
      cell.card.current_power.right += amount;
      cell.card.current_power.bottom += amount;
      cell.card.current_power.left += amount;
    }

    return newState;
  }

  private static swapCardsAbility(
    gameState: GameState,
    position: BoardPosition,
    playerId: string,
    parameters?: Record<string, any>
  ): GameState {
    const newState = _.cloneDeep(gameState);
    if (!parameters?.targetPosition) return newState;

    const targetPos = parameters.targetPosition as BoardPosition;
    if (
      targetPos.x < 0 ||
      targetPos.x >= 4 ||
      targetPos.y < 0 ||
      targetPos.y >= 4 ||
      (position.x === targetPos.x && position.y === targetPos.y)
    ) {
      return newState;
    }

    const sourceCell = newState.board[position.y][position.x];
    const targetCell = newState.board[targetPos.y][targetPos.x];

    if (sourceCell && targetCell) {
      newState.board[position.y][position.x] = targetCell;
      newState.board[targetPos.y][targetPos.x] = sourceCell;
    }

    return newState;
  }

  private static revealEnemyHandAbility(
    gameState: GameState,
    position: BoardPosition,
    playerId: string,
    parameters?: Record<string, any>
  ): GameState {
    // This would have a more comprehensive implementation in a real game,
    // including UI effects to reveal the opponent's hand to the player
    // For our MVP, we'll just signal that the hand was revealed
    const newState = _.cloneDeep(gameState);

    // For now, just set a flag to indicate the ability was activated
    // In a real implementation, we might set a property on the game state
    // to track this information and use it in the frontend

    return newState;
  }
}
