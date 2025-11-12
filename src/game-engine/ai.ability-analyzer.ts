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
  getCardsByCondition,
  getCardTotalPower,
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

    // Apply game state context multipliers
    const contextMultiplier = this.getGameStateContextMultiplier(
      gameState,
      card,
      aiPlayerId
    );
    score *= contextMultiplier;

    return score;
  }

  /**
   * Determines game phase and returns multiplier for ability scoring
   * Certain abilities are more valuable in different game phases
   */
  private getGameStateContextMultiplier(
    gameState: GameState,
    card: InGameCard,
    aiPlayerId: string
  ): number {
    if (!card.base_card_data.special_ability) {
      return 1.0;
    }

    const abilityName = card.base_card_data.special_ability.name;
    const gamePhase = this.detectGamePhase(gameState);
    const boardPosition = this.detectBoardPosition(gameState, aiPlayerId);

    let multiplier = 1.0;

    // === EARLY GAME (0-4 cards on board) ===
    if (gamePhase === 'early') {
      // Card draw is extremely valuable early
      if (abilityName === "Swift Messenger" || abilityName === "Fated Draw") {
        multiplier *= 1.5;
      }
      // Terrain setup is valuable early
      else if (abilityName === "Wild Shift" || abilityName === "Rain's Blessing" || 
               abilityName === "Lava Field") {
        multiplier *= 1.4;
      }
      // Scaling abilities should be played early
      else if (abilityName === "Lava Field" || abilityName === "Warrior's Aura") {
        multiplier *= 1.3;
      }
      // Comeback mechanics are less valuable early
      else if (abilityName === "Avenge Baldr" || abilityName === "War Stance" || 
               abilityName === "Past Weaves") {
        multiplier *= 0.5;
      }
    }

    // === MID GAME (5-10 cards on board) ===
    else if (gamePhase === 'mid') {
      // Board control and positioning abilities shine
      if (abilityName === "Foresight" || abilityName === "Thunderous Push" || 
          abilityName === "Binding Justice") {
        multiplier *= 1.3;
      }
      // Buff abilities are valuable
      else if (abilityName === "Mother's Blessing" || abilityName === "Poet's Rhythm") {
        multiplier *= 1.2;
      }
    }

    // === LATE GAME (11+ cards on board) ===
    else if (gamePhase === 'late') {
      // Finisher abilities are most valuable
      if (abilityName === "War Stance" || abilityName === "Devourer's Surge" || 
          abilityName === "Trickster's Gambit") {
        multiplier *= 1.4;
      }
      // Invincibility cards to lock down positions
      else if (abilityName === "Titan Shell" || abilityName === "Ocean's Shield") {
        multiplier *= 1.3;
      }
      // Comeback mechanics reach full power
      else if (abilityName === "Avenge Baldr" || abilityName === "Past Weaves") {
        multiplier *= 1.4;
      }
      // Card draw less valuable late
      else if (abilityName === "Swift Messenger" || abilityName === "Fated Draw") {
        multiplier *= 0.7;
      }
    }

    // === LOSING POSITION ===
    if (boardPosition === 'losing') {
      // Comeback mechanics are critical
      if (abilityName === "Avenge Baldr" || abilityName === "War Stance" || 
          abilityName === "Past Weaves" || abilityName === "Binding Justice") {
        multiplier *= 1.8;
      }
      // Global debuffs to equalize
      else if (abilityName === "Thunderous Push" || abilityName === "Many Heads") {
        multiplier *= 1.4;
      }
      // Destruction abilities to remove threats
      else if (abilityName === "Storm Breaker" || abilityName === "Flames of Muspelheim" || 
               abilityName === "Tidal Sweep") {
        multiplier *= 1.5;
      }
      // Protection to stabilize
      else if (abilityName === "Titan Shell" || abilityName === "Light Undimmed") {
        multiplier *= 1.3;
      }
    }

    // === WINNING POSITION ===
    else if (boardPosition === 'winning') {
      // Consolidation and protection
      if (abilityName === "Titan Shell" || abilityName === "Ocean's Shield" || 
          abilityName === "Light Undimmed") {
        multiplier *= 1.4;
      }
      // Buff allies to maintain advantage
      else if (abilityName === "Foresight" || abilityName === "Mother's Blessing") {
        multiplier *= 1.3;
      }
      // Recurring effects to build momentum
      else if (abilityName === "Warrior's Aura" || abilityName === "Vengeful Bite" || 
               abilityName === "Moon's Balance") {
        multiplier *= 1.3;
      }
      // Comeback mechanics are less valuable
      else if (abilityName === "Avenge Baldr" || abilityName === "War Stance") {
        multiplier *= 0.6;
      }
    }

    // === EVEN POSITION ===
    else if (boardPosition === 'even') {
      // Everything at standard value, but slight boost to versatile abilities
      if (abilityName === "Swift Messenger" || abilityName === "Storm Breaker" || 
          abilityName === "Foresight") {
        multiplier *= 1.1;
      }
    }

    return multiplier;
  }

  /**
   * Detects which phase of the game we're in based on board state
   */
  private detectGamePhase(gameState: GameState): 'early' | 'mid' | 'late' {
    const totalCardsPlayed = [...gameState.board.flat()]
      .filter(cell => cell?.card).length;

    if (totalCardsPlayed <= 4) {
      return 'early';
    } else if (totalCardsPlayed <= 10) {
      return 'mid';
    } else {
      return 'late';
    }
  }

  /**
   * Detects if AI is winning, losing, or even
   */
  private detectBoardPosition(
    gameState: GameState,
    aiPlayerId: string
  ): 'winning' | 'losing' | 'even' {
    const board = gameState.board;
    let aiCards = 0;
    let enemyCards = 0;
    let aiPower = 0;
    let enemyPower = 0;

    for (const row of board) {
      for (const cell of row) {
        if (cell?.card) {
          const cardPower = cell.card.current_power.top + 
                           cell.card.current_power.right +
                           cell.card.current_power.bottom + 
                           cell.card.current_power.left;

          if (cell.card.owner === aiPlayerId) {
            aiCards++;
            aiPower += cardPower;
          } else {
            enemyCards++;
            enemyPower += cardPower;
          }
        }
      }
    }

    // Calculate advantage
    const cardAdvantage = aiCards - enemyCards;
    const powerAdvantage = aiPower - enemyPower;

    // Weighted score: cards count more than raw power
    const advantage = (cardAdvantage * 2) + (powerAdvantage / 10);

    if (advantage > 3) {
      return 'winning';
    } else if (advantage < -3) {
      return 'losing';
    } else {
      return 'even';
    }
  }

  /**
   * Evaluates when an ability triggers (earlier = generally better)
   */
  private evaluateTriggerTiming(triggerMoment: TriggerMoment): number {
    const timingScores: { [key: string]: number } = {
      // Immediate triggers (highest value)
      [TriggerMoment.OnPlace]: 30, // Immediate impact on placement
      [TriggerMoment.BeforeCombat]: 25, // Setup before combat
      
      // Combat triggers
      [TriggerMoment.OnCombat]: 22, // During combat resolution
      [TriggerMoment.AfterCombat]: 20, // Cleanup after combat
      [TriggerMoment.OnDefend]: 20, // Defensive value when defending
      
      // Universal reactive triggers (Any*)
      [TriggerMoment.AnyOnFlip]: 20, // Triggers when ANY card flips
      [TriggerMoment.AnyOnPlace]: 18, // Triggers when ANY card is placed
      [TriggerMoment.AnyOnDefend]: 17, // Triggers when ANY card defends
      [TriggerMoment.AnyOnFlipped]: 15, // Triggers when ANY card gets flipped
      
      // Board-wide reactive triggers
      [TriggerMoment.BoardOnFlip]: 16, // Board card reacting to flips
      [TriggerMoment.BoardOnPlace]: 14, // Board card reacting to placements
      
      // Turn/Round lifecycle triggers
      [TriggerMoment.OnTurnStart]: 15, // Start of turn value
      [TriggerMoment.HandOnRoundStart]: 15, // In hand at round start
      [TriggerMoment.OnFlip]: 15, // When this card gets flipped
      [TriggerMoment.HandOnDefend]: 14, // In hand when defending
      [TriggerMoment.HandOnRoundEnd]: 13, // In hand at round end
      [TriggerMoment.HandOnTurnStart]: 12, // In hand at turn start
      [TriggerMoment.OnTurnEnd]: 12, // End of turn value
      [TriggerMoment.OnFlipped]: 12, // When this card flips an enemy
      
      // Hand triggers (lower immediate value, but strategic hold value)
      [TriggerMoment.HandOnFlip]: 10, // In hand when flips occur
      [TriggerMoment.HandOnTurnEnd]: 10, // In hand at turn end
      [TriggerMoment.OnRoundStart]: 10, // Round start triggers
      [TriggerMoment.HandOnPlace]: 8, // In hand when placing cards
      [TriggerMoment.OnRoundEnd]: 8, // Round end triggers
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
    const allEnemies = getCardsByCondition(board, (c) => c.owner !== aiPlayerId);
    const cardsInRow = getCardsInSameRow(position, board, aiPlayerId);
    const cardsInColumn = getCardsInSameColumn(position, board, aiPlayerId);
    const emptyAdjacent = adjacentCards.length < 4 ? 4 - adjacentCards.length : 0;

    // Get count of defeated allies for comeback mechanics
    const aiPlayer = gameState.player1.user_id === aiPlayerId ? gameState.player1 : gameState.player2;
    const defeatedAlliesCount = aiPlayer.discard_pile?.length || 0;

    // === CARD DRAW ABILITIES (Very High Value) ===
    if (abilityName === "Swift Messenger") {
      score += AI_CONFIG.MOVE_EVALUATION.DRAW_CARD_VALUE * 2;
    } else if (abilityName === "Fated Draw") {
      score += AI_CONFIG.MOVE_EVALUATION.DRAW_CARD_VALUE;
    }

    // === INVINCIBILITY/PROTECTION ABILITIES (Extremely High Defensive Value) ===
    else if (abilityName === "Titan Shell") {
      // Can only be defeated by Thor - nearly invincible
      score += AI_CONFIG.MOVE_EVALUATION.PROTECTION_VALUE * 2.5;
    } else if (abilityName === "Light Undimmed") {
      // Cannot be defeated by special abilities
      score += AI_CONFIG.MOVE_EVALUATION.PROTECTION_VALUE * 1.8;
    } else if (abilityName === "Ocean's Shield") {
      // Cannot be defeated by enemies with lower total power
      score += AI_CONFIG.MOVE_EVALUATION.PROTECTION_VALUE * 1.5;
    } else if (abilityName === "Harbor Guardian") {
      // Sacrifices power to protect allies - high utility
      score += AI_CONFIG.MOVE_EVALUATION.PROTECTION_VALUE * (allAllies.length > 2 ? 1.5 : 0.8);
    }

    // === GLOBAL BUFF/DEBUFF ABILITIES ===
    else if (abilityName === "Foresight") {
      // Permanent +1 to all allies
      score += allAllies.length * AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE * 2; // Permanent buff
    } else if (abilityName === "Thunderous Push") {
      // Debuff all enemies
      score += allEnemies.length * AI_CONFIG.MOVE_EVALUATION.DEBUFF_ENEMY_VALUE;
    } else if (abilityName === "Binding Justice") {
      // Equalizes power - great when opponent has strong cards
      const hasStrongEnemies = allEnemies.some((e) => getCardTotalPower(e) > 20);
      score += hasStrongEnemies ? AI_CONFIG.MOVE_EVALUATION.FLIP_ENEMY_VALUE * 2 : 50;
    } else if (abilityName === "Watchman's Gate") {
      // After 3 rounds: -1 to played cards, +1 to hand cards
      // Value depends on having more disposable cards on board than opponent
      const boardAdvantage = allEnemies.length > allAllies.length;
      score += boardAdvantage ? 100 : 40;
    }

    // === DESTRUCTION/REMOVAL ABILITIES ===
    else if (abilityName === "Storm Breaker") {
      // Destroys strongest enemy Beast/Dragon, gains +2
      const hasTargetTag = allEnemies.some((e) => 
        e.base_card_data.tags.includes("Beast") || e.base_card_data.tags.includes("Dragon")
      );
      score += hasTargetTag ? AI_CONFIG.MOVE_EVALUATION.FLIP_ENEMY_VALUE * 2 : 30;
    } else if (abilityName === "Flames of Muspelheim") {
      // Destroys strongest adjacent enemy, -1 to others
      score += adjacentEnemies.length > 0 ? AI_CONFIG.MOVE_EVALUATION.FLIP_ENEMY_VALUE * 1.5 : 0;
    } else if (abilityName === "Tidal Sweep") {
      // Defeats enemies diagonally if lower total power
      score += AI_CONFIG.MOVE_EVALUATION.FLIP_ENEMY_VALUE * 0.8;
    } else if (abilityName === "Devourer's Surge") {
      // Destroys weaker adjacent enemy each round, gains +1
      score += adjacentEnemies.length > 0 ? AI_CONFIG.MOVE_EVALUATION.FLIP_ENEMY_VALUE * 2 : 60;
    }

    // === COMEBACK/SCALING ABILITIES ===
    else if (abilityName === "Avenge Baldr") {
      // +1 to all stats per ally defeated
      score += defeatedAlliesCount * AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE * 2;
    } else if (abilityName === "War Stance") {
      // Gains +1 per ally defeated (max 5), then attacks again
      score += defeatedAlliesCount * AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE * 1.5;
      if (defeatedAlliesCount >= 3) score += AI_CONFIG.MOVE_EVALUATION.FLIP_ENEMY_VALUE; // Double attack value
    } else if (abilityName === "Past Weaves") {
      // +1 to all stats per destroyed ally
      score += defeatedAlliesCount * AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE * 1.5;
    } else if (abilityName === "Silent Vengeance") {
      // +3 to all stats if Odin defeated - conditional powerhouse
      // TODO: Check if Odin is defeated
      score += 50; // Base value, would be much higher if condition met
    }

    // === ADJACENCY-BASED BUFFS (Permanent) ===
    else if (abilityName === "Mother's Blessing") {
      // Permanent +1 to adjacent allies
      score += adjacentAllies.length * AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE * 2;
    } else if (abilityName === "Battle Cry") {
      // Temporary +1 to adjacent allies
      score += adjacentAllies.length * AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE;
    } else if (abilityName === "Poet's Rhythm") {
      // Temporary +1 to adjacent allies for a round
      score += adjacentAllies.length * AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE;
    } else if (abilityName === "Warrior's Blessing") {
      // Temporary +2 to adjacent allies
      score += adjacentAllies.length * AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE * 1.5;
    } else if (abilityName === "Allies Rally") {
      // Temporary +1 to adjacent allies
      score += adjacentAllies.length * AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE;
    }

    // === CONDITIONAL POWER BOOSTS ===
    else if (abilityName === "Sea's Protection") {
      // +3 if adjacent to Sea card
      const hasSeaAdjacent = adjacentAllies.some((c) => c.base_card_data.tags.includes("Sea"));
      score += hasSeaAdjacent ? AI_CONFIG.MOVE_EVALUATION.SYNERGY_BONUS * 2 : 20;
    } else if (abilityName === "Valkyrie Sisterhood") {
      // +2 if adjacent to Valkyrie
      const hasValkyrieAdjacent = adjacentAllies.some((c) => c.base_card_data.tags.includes("Valkyrie"));
      score += hasValkyrieAdjacent ? AI_CONFIG.MOVE_EVALUATION.SYNERGY_BONUS * 1.5 : 15;
    } else if (abilityName === "Worthy Opponent") {
      // +1 to all if adjacent to Thor
      const hasThorAdjacent = adjacentAllies.some((c) => c.base_card_data.name === "Thor");
      score += hasThorAdjacent ? AI_CONFIG.MOVE_EVALUATION.SYNERGY_BONUS : 15;
    } else if (abilityName === "Bride Demand") {
      // +3 Right if adjacent to Goddess
      const hasGoddessAdjacent = adjacentAllies.some((c) => c.base_card_data.tags.includes("Goddess"));
      score += hasGoddessAdjacent ? AI_CONFIG.MOVE_EVALUATION.SYNERGY_BONUS * 1.5 : 10;
    } else if (abilityName === "Peaceful Strength") {
      // +2 if no adjacent enemies
      score += adjacentEnemies.length === 0 ? AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE * 1.5 : 0;
    } else if (abilityName === "Primordial Force") {
      // +2 to all if no adjacent cards
      score += adjacentCards.length === 0 ? AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE * 2 : 0;
    } else if (abilityName === "Shore Fury") {
      // +2 if on edge
      const isEdge = position.x === 0 || position.x === 3 || position.y === 0 || position.y === 3;
      score += isEdge ? AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE * 1.5 : 0;
    } else if (abilityName === "Steadfast Guard") {
      // +1 per adjacent enemy
      score += adjacentEnemies.length * AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE;
    } else if (abilityName === "Beast Friend") {
      // Gains +1 per adjacent enemy stronger than self
      const strongerEnemies = adjacentEnemies.filter((e) => getCardTotalPower(e) > getCardTotalPower(card));
      score += strongerEnemies.length * AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE * 1.5;
    }

    // === TRIBAL/TAG-BASED ABILITIES ===
    else if (abilityName === "Dragon Slayer") {
      // +1 per Dragon on board
      const dragonCount = [...allAllies, ...allEnemies].filter((c) => c.base_card_data.tags.includes("Dragon")).length;
      score += dragonCount * AI_CONFIG.MOVE_EVALUATION.SYNERGY_BONUS;
    } else if (abilityName === "Demon Bane") {
      // Gains +1 when any demon defeated
      const hasDemon = allEnemies.some((c) => c.base_card_data.tags.includes("Demon"));
      score += hasDemon ? AI_CONFIG.MOVE_EVALUATION.SYNERGY_BONUS : 20;
    }

    // === DEBUFF ABILITIES ===
    else if (abilityName === "Frost Row") {
      // Enemies in row lose 1 temporarily
      score += cardsInRow.length * AI_CONFIG.MOVE_EVALUATION.DEBUFF_ENEMY_VALUE;
    } else if (abilityName === "Piercing Shot") {
      // Enemies in column permanently lose 1
      score += cardsInColumn.length * AI_CONFIG.MOVE_EVALUATION.DEBUFF_ENEMY_VALUE * 2;
    } else if (abilityName === "Many Heads") {
      // -1 to enemies in row or column
      score += (cardsInRow.length + cardsInColumn.length) * AI_CONFIG.MOVE_EVALUATION.DEBUFF_ENEMY_VALUE * 0.5;
    } else if (abilityName === "Bone Chill") {
      // Adjacent enemies lose 1
      score += adjacentEnemies.length * AI_CONFIG.MOVE_EVALUATION.DEBUFF_ENEMY_VALUE;
    } else if (abilityName === "Icy Presence") {
      // Adjacent enemies permanently lose 1
      score += adjacentEnemies.length * AI_CONFIG.MOVE_EVALUATION.DEBUFF_ENEMY_VALUE * 2;
    } else if (abilityName === "Venomous Presence") {
      // Strongest adjacent enemy loses 2
      score += adjacentEnemies.length > 0 ? AI_CONFIG.MOVE_EVALUATION.DEBUFF_ENEMY_VALUE * 2 : 0;
    } else if (abilityName === "Vengeful Bite") {
      // -1 to adjacent enemies each round
      score += adjacentEnemies.length * AI_CONFIG.MOVE_EVALUATION.DEBUFF_ENEMY_VALUE * 1.5;
    }

    // === TERRAIN/TILE MANIPULATION ===
    else if (abilityName === "Winter's Grasp") {
      // Freeze adjacent tile for 1 turn
      score += AI_CONFIG.MOVE_EVALUATION.TILE_MANIPULATION_VALUE * emptyAdjacent;
    } else if (abilityName === "Web Curse") {
      // Curse adjacent tiles, drain power for 1 round
      score += emptyAdjacent * AI_CONFIG.MOVE_EVALUATION.TILE_MANIPULATION_VALUE * 2;
    } else if (abilityName === "Hex Field") {
      // Curse empty adjacent tiles
      score += emptyAdjacent * AI_CONFIG.MOVE_EVALUATION.TILE_MANIPULATION_VALUE;
    } else if (abilityName === "Wild Shift") {
      // Create lava every round
      score += AI_CONFIG.MOVE_EVALUATION.TILE_MANIPULATION_VALUE * 2; // Recurring effect
    } else if (abilityName === "Lava Field") {
      // Gains +1 per card played on lava
      score += AI_CONFIG.MOVE_EVALUATION.TILE_MANIPULATION_VALUE * 1.5; // Scaling value
    } else if (abilityName === "Rain's Blessing") {
      // Fill tile with water, allies placed after gain +1
      score += AI_CONFIG.MOVE_EVALUATION.TILE_MANIPULATION_VALUE * 2;
    } else if (abilityName === "Pure Waters") {
      // Fill tile with water, cleanse all allies
      score += AI_CONFIG.MOVE_EVALUATION.TILE_MANIPULATION_VALUE + (allAllies.length * 20);
    } else if (abilityName === "Sacred Spring") {
      // On water: bless ally and cleanse adjacent allies each round
      score += AI_CONFIG.MOVE_EVALUATION.TILE_MANIPULATION_VALUE * 2;
    } else if (abilityName === "Feast or Famine") {
      // When ally defeated, fill tile with water
      score += AI_CONFIG.MOVE_EVALUATION.TILE_MANIPULATION_VALUE;
    }

    // === UTILITY/CLEANSING ===
    else if (abilityName === "Cleansing Hula") {
      // Cleanse random ally each round
      score += allAllies.length > 0 ? AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE * 0.8 : 20;
    } else if (abilityName === "Healing Touch") {
      // Cleanse adjacent allies
      score += adjacentAllies.length * AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE * 0.5;
    } else if (abilityName === "Erase Face") {
      // Remove all buffs from adjacent enemies
      score += adjacentEnemies.length * AI_CONFIG.MOVE_EVALUATION.DEBUFF_ENEMY_VALUE * 0.8;
    } else if (abilityName === "Time Shift") {
      // Remove temporary buffs from enemy in column
      score += cardsInColumn.length > 0 ? AI_CONFIG.MOVE_EVALUATION.DEBUFF_ENEMY_VALUE : 20;
    }

    // === POSITIONAL MANIPULATION ===
    else if (abilityName === "Gale Aura") {
      // Push adjacent enemies away
      score += adjacentEnemies.length * AI_CONFIG.MOVE_EVALUATION.BOARD_CONTROL_VALUE;
    } else if (abilityName === "Drowning Net") {
      // Pull enemy cards closer before combat
      score += AI_CONFIG.MOVE_EVALUATION.BOARD_CONTROL_VALUE * 1.5;
    }

    // === REACTIVE/TRIGGER ABILITIES ===
    else if (abilityName === "Hunter's Mark") {
      // When ally defeated, drain -1 from attacker
      score += allAllies.length * AI_CONFIG.MOVE_EVALUATION.DEBUFF_ENEMY_VALUE * 0.5;
    } else if (abilityName === "Spirit Bind") {
      // If defeated, attacker loses 1 permanently
      score += AI_CONFIG.MOVE_EVALUATION.DEBUFF_ENEMY_VALUE * 1.5;
    } else if (abilityName === "Radiant Blessing") {
      // When ally defeated, +1 to random ally
      score += AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE * 0.8;
    } else if (abilityName === "Soul Lock") {
      // Enemies Hel defeats become permanent allies
      score += AI_CONFIG.MOVE_EVALUATION.FLIP_ENEMY_VALUE * 3; // Very powerful
    }

    // === RECURRING EFFECTS ===
    else if (abilityName === "Warrior's Aura") {
      // +1 to allies in same row each round
      const alliesInRow = getAlliesAdjacentTo(position, board, aiPlayerId).filter(a => 
        getCardsInSameRow(position, board, aiPlayerId).includes(a)
      );
      score += alliesInRow.length * AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE * 1.5;
    } else if (abilityName === "Moon's Balance") {
      // Each round: -1 to strongest enemy, +1 to weakest ally
      score += allEnemies.length > 0 ? AI_CONFIG.MOVE_EVALUATION.DEBUFF_ENEMY_VALUE * 1.5 : 40;
    } else if (abilityName === "Fertile Ground") {
      // Each round grant +1 to allies with blessings
      score += allAllies.length * AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE * 0.5;
    } else if (abilityName === "Slipstream") {
      // Each round steal blessing from random enemy
      score += allEnemies.length > 0 ? 60 : 20;
    }

    // === SPECIAL MECHANICS ===
    else if (abilityName === "Trickster's Gambit") {
      // 50% chance to flip 4 random cards
      score += AI_CONFIG.MOVE_EVALUATION.FLIP_ENEMY_VALUE * 0.8; // High risk/reward
    } else if (abilityName === "Echo Power") {
      // Matches highest adjacent card power this turn
      score += adjacentCards.length > 0 ? AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE * 1.5 : 20;
    } else if (abilityName === "Dread Aura") {
      // Enemy abilities disabled next turn
      score += allEnemies.length * 30;
    } else if (abilityName === "Thunderous Omen") {
      // Random enemy loses random power
      score += allEnemies.length > 0 ? AI_CONFIG.MOVE_EVALUATION.DEBUFF_ENEMY_VALUE * 0.5 : 20;
    }

    // === HAND-SCALING ABILITIES (These should often be HELD, not played immediately) ===
    // Note: These get special treatment in hand-hold evaluation
    else if (abilityName === "Sun Trick") {
      // Gains +1 in hand each round, resets after combat
      // Base score is low - should be evaluated for holding
      score += 40;
    } else if (abilityName === "Tide Ward") {
      // While in hand: +1 to each played card. When played: steal blessings
      // Should usually be held
      score += 50;
    } else if (abilityName === "Pure Waters") {
      // Gains +1 in hand per blessed tile (max 5)
      score += 45;
    }

    // === DUAL ASPECT & SYNERGY ABILITIES ===
    else if (abilityName === "Dual Aspect") {
      // -1 to random enemy per water tile
      score += AI_CONFIG.MOVE_EVALUATION.DEBUFF_ENEMY_VALUE;
    }

    // === FALLBACK: General ability type detection ===
    else if (card.base_card_data.special_ability) {
      const description = card.base_card_data.special_ability.description.toLowerCase();

      // Check for permanent vs temporary effects
      const isPermanent = description.includes("permanent") || 
                          !description.includes("turn") && 
                          !description.includes("round");
      const multiplier = isPermanent ? 2 : 1;

      if (description.includes("buff") || description.includes("gain") || description.includes("+")) {
        score += AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE * multiplier;
      }
      if (description.includes("debuff") || description.includes("lose") || description.includes("-")) {
        score += AI_CONFIG.MOVE_EVALUATION.DEBUFF_ENEMY_VALUE * multiplier;
      }
      if (description.includes("draw")) {
        score += AI_CONFIG.MOVE_EVALUATION.DRAW_CARD_VALUE;
      }
      if (description.includes("flip") || description.includes("defeat") || description.includes("destroy")) {
        score += AI_CONFIG.MOVE_EVALUATION.FLIP_ENEMY_VALUE;
      }
      if (description.includes("protect") || description.includes("cannot be defeated")) {
        score += AI_CONFIG.MOVE_EVALUATION.PROTECTION_VALUE;
      }
      if (description.includes("terrain") || description.includes("tile") || description.includes("lava") || description.includes("water")) {
        score += AI_CONFIG.MOVE_EVALUATION.TILE_MANIPULATION_VALUE;
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

  /**
   * Evaluates whether a card should be held in hand rather than played
   * Returns a positive score if holding is beneficial, negative if should play immediately
   */
  evaluateHandHoldValue(
    gameState: GameState,
    card: InGameCard,
    aiPlayerId: string
  ): number {
    if (!card.base_card_data.special_ability) {
      return -100; // No ability, should play normally
    }

    const abilityName = card.base_card_data.special_ability.name;
    const ability = card.base_card_data.special_ability;
    let holdValue = 0;

    // Check if card has HandOn* triggers (provides value while in hand)
    let triggerMoments: any = ability.triggerMoments || [];
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

    const hasHandTrigger = triggerMoments.some((tm: string) => 
      tm.includes('Hand') || tm === TriggerMoment.HandOnFlip || 
      tm === TriggerMoment.HandOnPlace || tm === TriggerMoment.HandOnTurnStart ||
      tm === TriggerMoment.HandOnTurnEnd || tm === TriggerMoment.HandOnRoundStart ||
      tm === TriggerMoment.HandOnRoundEnd || tm === TriggerMoment.HandOnDefend
    );

    if (hasHandTrigger) {
      holdValue += 50; // Base value for hand triggers
    }

    // === CARDS THAT SCALE IN HAND (Should be held) ===
    if (abilityName === "Sun Trick") {
      // Gains +1 every round in hand, resets after combat
      // Calculate how many rounds it's been held
      const currentPower = getCardTotalPower(card);
      const basePower = card.base_card_data.base_power.top + 
                        card.base_card_data.base_power.right + 
                        card.base_card_data.base_power.bottom + 
                        card.base_card_data.base_power.left;
      const powerGain = currentPower - basePower;
      
      // Hold if it hasn't reached good power yet (suggest holding for 2-3 rounds)
      if (powerGain < 8) { // Less than 2 rounds of buffs
        holdValue += 150 - (powerGain * 20); // High hold value, decreases as it gains power
      } else {
        holdValue -= 50; // It's powerful now, time to play it
      }
    } else if (abilityName === "Pure Waters") {
      // Gains +1 in hand whenever a tile is blessed (max 5)
      const currentPower = getCardTotalPower(card);
      const basePower = card.base_card_data.base_power.top + 
                        card.base_card_data.base_power.right + 
                        card.base_card_data.base_power.bottom + 
                        card.base_card_data.base_power.left;
      const powerGain = currentPower - basePower;
      
      // Hold until it gains significant power
      if (powerGain < 12) { // Less than 3 blessings collected
        holdValue += 120 - (powerGain * 10);
      } else {
        holdValue -= 40; // Near max power, play it
      }
    } else if (abilityName === "Tide Ward") {
      // While in hand: grants +1 to each card played
      // When played: steals all the blessings back
      // This is a HIGH VALUE hold card
      const aiPlayer = gameState.player1.user_id === aiPlayerId ? gameState.player1 : gameState.player2;
      const cardsInHand = aiPlayer.hand.length;
      
      // Hold it if we have other cards to play (it boosts them)
      if (cardsInHand > 2) {
        holdValue += 180; // Very high hold value
      } else if (cardsInHand === 2) {
        holdValue += 80; // Still good to hold
      } else {
        holdValue -= 60; // Last card, play it to get the blessings
      }
    }

    // === COMEBACK MECHANICS (Hold when losing) ===
    const aiPlayer = gameState.player1.user_id === aiPlayerId ? gameState.player1 : gameState.player2;
    const defeatedAlliesCount = aiPlayer.discard_pile?.length || 0;

    if (abilityName === "Avenge Baldr" || abilityName === "War Stance" || abilityName === "Past Weaves") {
      // These get stronger as allies are defeated
      if (defeatedAlliesCount < 3) {
        holdValue += 100 - (defeatedAlliesCount * 25); // Hold until more allies defeated
      } else {
        holdValue -= 80; // Powerful now, play it!
      }
    } else if (abilityName === "Silent Vengeance") {
      // Only powerful if Odin is defeated
      // TODO: Check if Odin is defeated
      // For now, hold it until late game
      const totalCardsPlayed = [...gameState.board.flat()].filter(cell => cell?.card).length;
      if (totalCardsPlayed < 8) {
        holdValue += 120; // Hold until condition might be met
      }
    }

    // === CONDITIONAL POWERHOUSES (Hold until condition met) ===
    if (abilityName === "Storm Breaker") {
      // Only useful if enemy has Beast or Dragon
      const allEnemies = getCardsByCondition(gameState.board, (c) => c.owner !== aiPlayerId);
      const hasTargetTag = allEnemies.some((e) => 
        e.base_card_data.tags.includes("Beast") || e.base_card_data.tags.includes("Dragon")
      );
      if (!hasTargetTag) {
        holdValue += 90; // Hold until target appears
      } else {
        holdValue -= 70; // Target available, play it!
      }
    } else if (abilityName === "Binding Justice") {
      // Equalizes power - best when opponent has very strong cards
      const allEnemies = getCardsByCondition(gameState.board, (c) => c.owner !== aiPlayerId);
      const hasStrongEnemies = allEnemies.some((e) => getCardTotalPower(e) > 24);
      if (!hasStrongEnemies) {
        holdValue += 70; // Hold until strong enemies appear
      } else {
        holdValue -= 60; // Strong enemies present, play it!
      }
    }

    // === DRAW CARDS (Play immediately for card advantage) ===
    if (abilityName === "Swift Messenger" || abilityName === "Fated Draw") {
      const cardsInHand = aiPlayer.hand.length;
      if (cardsInHand <= 2) {
        holdValue -= 120; // Low hand, play immediately for draw
      } else {
        holdValue -= 40; // Still valuable but less urgent
      }
    }

    // === TERRAIN SETUP CARDS (Play early) ===
    if (abilityName === "Wild Shift" || abilityName === "Rain's Blessing" || 
        abilityName === "Feast or Famine") {
      const totalCardsPlayed = [...gameState.board.flat()].filter(cell => cell?.card).length;
      if (totalCardsPlayed > 8) {
        holdValue += 50; // Late game, hold for better timing
      } else {
        holdValue -= 80; // Early game, play for setup
      }
    }

    // === INVINCIBILITY CARDS (Play when you need to lock down position) ===
    if (abilityName === "Titan Shell" || abilityName === "Ocean's Shield" || 
        abilityName === "Light Undimmed") {
      const allAllies = getAllAlliesOnBoard(gameState.board, aiPlayerId);
      const allEnemies = getCardsByCondition(gameState.board, (c) => c.owner !== aiPlayerId);
      
      // Hold if we're winning, play if we need defense
      if (allAllies.length > allEnemies.length + 2) {
        holdValue += 60; // Winning, can hold
      } else {
        holdValue -= 70; // Need defense, play it
      }
    }

    return holdValue;
  }
}
