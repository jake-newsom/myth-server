import { GameState, BoardPosition } from "../types/game.types";
import { InGameCard } from "../types/card.types";
import { TriggerMoment } from "../types/card.types";
import { AI_CONFIG } from "../config/constants";
import * as _ from "lodash";

// Helper function to safely check if an ability has a specific trigger
function hasTrigger(ability: any, trigger: TriggerMoment): boolean {
  if (!ability) return false;
  if (!ability.triggerMoments) return false;
  
  // Handle PostgreSQL array format or ensure it's a JavaScript array
  let triggerMoments = ability.triggerMoments;
  
  // If it's a string that looks like a PostgreSQL array, parse it
  if (typeof triggerMoments === 'string') {
    if (triggerMoments.startsWith('{') && triggerMoments.endsWith('}')) {
      triggerMoments = triggerMoments.slice(1, -1).split(',').map(t => t.trim()).filter(t => t.length > 0);
    } else {
      triggerMoments = [triggerMoments];
    }
  }
  
  if (!Array.isArray(triggerMoments)) return false;
  return triggerMoments.includes(trigger);
}
import {
  getAdjacentCards,
  getAlliesAdjacentTo,
  getEnemiesAdjacentTo,
  getCardsInSameRow,
  getCardsInSameColumn,
  getAllAlliesOnBoard,
} from "./ability.utils";

/**
 * Analyzes and scores the impact of card abilities for AI decision making
 */
export class AbilityAnalyzer {
  /**
   * Evaluates the potential value of a card's ability at a given position
   */
  evaluateAbilityImpact(
    gameState: GameState,
    card: InGameCard,
    position: BoardPosition,
    aiPlayerId: string
  ): number {
    let score = 0;

    if (!card.base_card_data.special_ability) {
      return 0;
    }

    const ability = card.base_card_data.special_ability;
    const abilityName = ability.name;
    
    // Safely get trigger moments array
    let triggerMoments: any = ability.triggerMoments || [];
    
    // Handle PostgreSQL array format
    if (typeof triggerMoments === 'string') {
      if (triggerMoments.startsWith('{') && triggerMoments.endsWith('}')) {
        triggerMoments = triggerMoments.slice(1, -1).split(',').map((t: string) => t.trim()).filter((t: string) => t.length > 0);
      } else {
        triggerMoments = [triggerMoments];
      }
    }
    
    if (!Array.isArray(triggerMoments)) {
      triggerMoments = [];
    }

    // Base value for having an ability
    score += AI_CONFIG.MOVE_EVALUATION.ABILITY_BASE_VALUE * 0.5;

    // Evaluate based on trigger moment (when does it activate?)
    // Evaluate trigger timing - take the best timing from all triggers
    if (triggerMoments.length > 0) {
      const bestTriggerScore = Math.max(...triggerMoments.map((tm: TriggerMoment) => this.evaluateTriggerTiming(tm)));
      score += bestTriggerScore;
    }

    // Evaluate specific ability effects
    score += this.evaluateSpecificAbility(
      abilityName,
      gameState,
      position,
      card,
      aiPlayerId
    );

    // Evaluate synergies with board state
    score += this.evaluateAbilitySynergy(
      abilityName,
      gameState,
      position,
      card,
      aiPlayerId
    );

    return score;
  }

  /**
   * Evaluates when an ability triggers (earlier = generally better)
   */
  private evaluateTriggerTiming(triggerMoment: TriggerMoment): number {
    const timingScores: { [key: string]: number } = {
      [TriggerMoment.OnPlace]: 30, // Immediate impact
      [TriggerMoment.BeforeCombat]: 25,
      [TriggerMoment.AfterCombat]: 20,
      [TriggerMoment.OnFlip]: 15, // Requires being flipped
      [TriggerMoment.OnFlipped]: 10, // Requires flipping an enemy
      [TriggerMoment.OnTurnStart]: 15, // Future value
      [TriggerMoment.OnTurnEnd]: 12,
      [TriggerMoment.AnyOnFlip]: 18, // Reactive abilities
      [TriggerMoment.OnDefend]: 20, // Defensive value
      [TriggerMoment.HandOnFlip]: 10,
      [TriggerMoment.HandOnPlace]: 8,
    };

    return timingScores[triggerMoment] || 10;
  }

  /**
   * Evaluates specific known abilities with contextual scoring
   */
  private evaluateSpecificAbility(
    abilityName: string,
    gameState: GameState,
    position: BoardPosition,
    card: InGameCard,
    aiPlayerId: string
  ): number {
    let score = 0;
    const board = gameState.board;

    // Get relevant cards for evaluation
    const adjacentCards = getAdjacentCards(position, board);
    const adjacentAllies = getAlliesAdjacentTo(position, board, aiPlayerId);
    const adjacentEnemies = getEnemiesAdjacentTo(position, board, aiPlayerId);
    const allAllies = getAllAlliesOnBoard(board, aiPlayerId);
    const cardsInRow = getCardsInSameRow(position, board, aiPlayerId);
    const cardsInColumn = getCardsInSameColumn(position, board, aiPlayerId);

    // Norse Abilities
    if (abilityName === "Foresight") {
      // Buffs all allies - value scales with number of allies
      score += allAllies.length * AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE;
    } else if (abilityName === "Thunderous Push") {
      // Pushes adjacent enemies - value based on enemy count
      score +=
        adjacentEnemies.length * AI_CONFIG.MOVE_EVALUATION.BOARD_CONTROL_VALUE;
    } else if (abilityName === "Mother's Blessing") {
      // Buffs adjacent allies
      score +=
        adjacentAllies.length * AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE;
    } else if (abilityName === "Swift Messenger") {
      // Draws 2 cards - very valuable
      score += AI_CONFIG.MOVE_EVALUATION.DRAW_CARD_VALUE * 2;
    } else if (abilityName === "Storm Breaker") {
      // Defeats strongest enemy in row regardless of power
      if (cardsInRow.length > 0) {
        score += AI_CONFIG.MOVE_EVALUATION.FLIP_ENEMY_VALUE * 1.5; // High value
      }
    } else if (abilityName === "Dragon Slayer") {
      // Gains +3 if adjacent to Dragon
      const hasDragonNearby = adjacentCards.some((c) =>
        c.base_card_data.tags.includes("Dragon")
      );
      if (hasDragonNearby) {
        score += AI_CONFIG.MOVE_EVALUATION.SYNERGY_BONUS * 1.5;
      }
    } else if (abilityName === "Tidal Sweep") {
      // Enemies in same column lose power
      score +=
        cardsInColumn.length * AI_CONFIG.MOVE_EVALUATION.DEBUFF_ENEMY_VALUE;
    } else if (abilityName === "Winter's Grasp") {
      // Freezes adjacent tile
      score += AI_CONFIG.MOVE_EVALUATION.TILE_MANIPULATION_VALUE;
    } else if (abilityName === "Flames of Muspelheim") {
      // Destroys strongest adjacent enemy
      if (adjacentEnemies.length > 0) {
        score +=
          AI_CONFIG.MOVE_EVALUATION.FLIP_ENEMY_VALUE * adjacentEnemies.length;
      }
    } else if (abilityName === "Light Undimmed") {
      // Cannot be defeated by special abilities - defensive
      score += AI_CONFIG.MOVE_EVALUATION.PROTECTION_VALUE;
    } else if (abilityName === "Titan Shell") {
      // Can only be defeated by Thor - very strong defensive
      score += AI_CONFIG.MOVE_EVALUATION.PROTECTION_VALUE * 1.5;
    }

    // Japanese Abilities
    else if (abilityName === "Frost Row") {
      // Enemies in same row lose power
      score += cardsInRow.length * AI_CONFIG.MOVE_EVALUATION.DEBUFF_ENEMY_VALUE;
    } else if (abilityName === "Web Curse") {
      // Adjacent tiles cursed - strong area denial
      const emptyAdjacent =
        adjacentCards.length < 4 ? 4 - adjacentCards.length : 0;
      score +=
        emptyAdjacent * AI_CONFIG.MOVE_EVALUATION.TILE_MANIPULATION_VALUE;
    } else if (abilityName === "Slipstream") {
      // Gains power if next to defeated card
      const hasDefeatedNearby = adjacentCards.some((c) => c.defeats.length > 0);
      if (hasDefeatedNearby) {
        score += AI_CONFIG.MOVE_EVALUATION.SYNERGY_BONUS;
      }
    }

    // Polynesian Abilities
    else if (abilityName === "Lava Field") {
      // Fill empty tiles with lava
      const emptyAdjacent =
        adjacentCards.length < 4 ? 4 - adjacentCards.length : 0;
      score +=
        emptyAdjacent * AI_CONFIG.MOVE_EVALUATION.TILE_MANIPULATION_VALUE;
    } else if (abilityName === "Cleansing Hula") {
      // Cleanses allies of curses
      score +=
        adjacentAllies.length * AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE * 0.5;
    }

    // General ability type detection (fallback for abilities not explicitly listed)
    else if (card.base_card_data.special_ability) {
      const description =
        card.base_card_data.special_ability.description.toLowerCase();

      if (
        description.includes("buff") ||
        description.includes("gain") ||
        description.includes("+")
      ) {
        score += AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE;
      }
      if (
        description.includes("debuff") ||
        description.includes("lose") ||
        description.includes("-")
      ) {
        score += AI_CONFIG.MOVE_EVALUATION.DEBUFF_ENEMY_VALUE;
      }
      if (description.includes("draw")) {
        score += AI_CONFIG.MOVE_EVALUATION.DRAW_CARD_VALUE;
      }
      if (description.includes("flip") || description.includes("defeat")) {
        score += AI_CONFIG.MOVE_EVALUATION.FLIP_ENEMY_VALUE;
      }
      if (
        description.includes("protect") ||
        description.includes("cannot be defeated")
      ) {
        score += AI_CONFIG.MOVE_EVALUATION.PROTECTION_VALUE;
      }
    }

    return score;
  }

  /**
   * Evaluates synergy between this ability and the current board state
   */
  private evaluateAbilitySynergy(
    abilityName: string,
    gameState: GameState,
    position: BoardPosition,
    card: InGameCard,
    aiPlayerId: string
  ): number {
    let score = 0;
    const board = gameState.board;

    // Check for faction synergies
    const adjacentAllies = getAlliesAdjacentTo(position, board, aiPlayerId);
    const sameFactionCount = adjacentAllies.filter(
      (ally) => ally.base_card_data.set_id === card.base_card_data.set_id
    ).length;

    if (sameFactionCount > 0) {
      score += sameFactionCount * AI_CONFIG.MOVE_EVALUATION.SYNERGY_BONUS * 0.5;
    }

    // Check for tag synergies
    const cardTags = card.base_card_data.tags;
    if (cardTags.includes("Dragon")) {
      // Dragons are powerful, slight bonus
      score += 10;
    }
    if (cardTags.includes("Warrior")) {
      // Warriors benefit from adjacent allies
      score += adjacentAllies.length * 5;
    }
    if (cardTags.includes("Support")) {
      // Support cards are more valuable with many allies
      const allAllies = getAllAlliesOnBoard(board, aiPlayerId);
      score += allAllies.length * 8;
    }

    return score;
  }

  /**
   * Evaluates the potential for ability chains and combos
   */
  evaluateAbilityChains(
    gameState: GameState,
    card: InGameCard,
    position: BoardPosition,
    aiPlayerId: string
  ): number {
    let score = 0;

    if (!card.base_card_data.special_ability) {
      return 0;
    }

    const board = gameState.board;
    const adjacentCards = getAdjacentCards(position, board);

    // Check if placing this card would trigger other abilities
    // AnyOnPlace abilities would trigger
    for (const adjacentCard of adjacentCards) {
      if (
        adjacentCard.owner === aiPlayerId &&
        hasTrigger(
          adjacentCard.base_card_data.special_ability,
          TriggerMoment.AnyOnFlip
        )
      ) {
        score += AI_CONFIG.MOVE_EVALUATION.SYNERGY_BONUS * 0.8;
      }
    }

    // Check hand for HandOnPlace abilities
    const aiPlayer =
      gameState.player1.user_id === aiPlayerId
        ? gameState.player1
        : gameState.player2;

    for (const cardId of aiPlayer.hand) {
      const handCard = gameState.hydrated_card_data_cache?.[cardId];
      if (
        hasTrigger(
          handCard?.base_card_data.special_ability,
          TriggerMoment.HandOnPlace
        )
      ) {
        score += AI_CONFIG.MOVE_EVALUATION.SYNERGY_BONUS * 0.6;
      }
    }

    return score;
  }

  /**
   * Quick check if an ability would have immediate high value
   */
  hasHighImpactAbility(card: InGameCard): boolean {
    if (!card.base_card_data.special_ability) {
      return false;
    }

    const highImpactAbilities = [
      "Swift Messenger", // Draw 2
      "Storm Breaker", // Auto defeat
      "Flames of Muspelheim", // Destroy strongest
      "Foresight", // Buff all allies
      "Titan Shell", // Nearly invincible
      "Light Undimmed", // Ability immune
    ];

    return highImpactAbilities.includes(
      card.base_card_data.special_ability.name
    );
  }
}
