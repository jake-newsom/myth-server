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
import { AbilityRuleEngine } from "./ai.rules.engine";

/**
 * Analyzes and scores the impact of card abilities for AI decision making
 */
export class AbilityAnalyzer {
  private ruleEngine = new AbilityRuleEngine();

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
    const abilityName = ability.id ?? ability.ability_id ?? "";
    
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

    // Apply data-driven ability rules for explicit prefer/avoid behavior.
    score += this.ruleEngine.evaluate({
      gameState,
      card,
      position,
      aiPlayerId,
    }).totalScore;

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

    const abilityName =
      card.base_card_data.special_ability.id ??
      card.base_card_data.special_ability.ability_id ??
      "";
    const gamePhase = this.detectGamePhase(gameState);
    const boardPosition = this.detectBoardPosition(gameState, aiPlayerId);

    let multiplier = 1.0;

    // === EARLY GAME (0-4 cards on board) ===
    if (gamePhase === 'early') {
      // Card draw is extremely valuable early
      if (
        abilityName === "sleipnir_swift_messenger" ||
        abilityName === "verdandi_present"
      ) {
        multiplier *= 1.5;
      }
      // Terrain setup is valuable early
      else if (
        abilityName === "kamapuaa_wild_shift" ||
        abilityName === "hauwahine_rains_blessing" ||
        abilityName === "pele_lava_field"
      ) {
        multiplier *= 1.4;
      }
      // Scaling abilities should be played early
      else if (
        abilityName === "pele_lava_field" ||
        abilityName === "hachiman_warriors_aura"
      ) {
        multiplier *= 1.3;
      }
      // Comeback mechanics are less valuable early
      else if (
        abilityName === "vali_revenge" ||
        abilityName === "ku_war_stance" ||
        abilityName === "urd_past_weaves"
      ) {
        multiplier *= 0.5;
      }
    }

    // === MID GAME (5-10 cards on board) ===
    else if (gamePhase === 'mid') {
      // Board control and positioning abilities shine
      if (
        abilityName === "odin_foresight" ||
        abilityName === "thor_push" ||
        abilityName === "tyr_binding_justice"
      ) {
        multiplier *= 1.3;
      }
      // Buff abilities are valuable
      else if (
        abilityName === "frigg_bless" ||
        abilityName === "bragi_inspire"
      ) {
        multiplier *= 1.2;
      }
    }

    // === LATE GAME (11+ cards on board) ===
    else if (gamePhase === 'late') {
      // Finisher abilities are most valuable
      if (
        abilityName === "ku_war_stance" ||
        abilityName === "fenrir_devourer_surge" ||
        abilityName === "loki_flip"
      ) {
        multiplier *= 1.4;
      }
      // Invincibility cards to lock down positions
      else if (
        abilityName === "jormungandr_shell" ||
        abilityName === "kamohoalii_oceans_shield"
      ) {
        multiplier *= 1.3;
      }
      // Comeback mechanics reach full power
      else if (
        abilityName === "vali_revenge" ||
        abilityName === "urd_past_weaves"
      ) {
        multiplier *= 1.4;
      }
      // Card draw less valuable late
      else if (
        abilityName === "sleipnir_swift_messenger" ||
        abilityName === "verdandi_present"
      ) {
        multiplier *= 0.7;
      }
    }

    // === LOSING POSITION ===
    if (boardPosition === 'losing') {
      // Comeback mechanics are critical
      if (
        abilityName === "vali_revenge" ||
        abilityName === "ku_war_stance" ||
        abilityName === "urd_past_weaves" ||
        abilityName === "tyr_binding_justice"
      ) {
        multiplier *= 1.8;
      }
      // Global debuffs to equalize
      else if (
        abilityName === "thor_push" ||
        abilityName === "yamata_many_heads"
      ) {
        multiplier *= 1.4;
      }
      // Destruction abilities to remove threats
      else if (
        abilityName === "susanoo_storm_breaker" ||
        abilityName === "surtr_flames" ||
        abilityName === "ryujin_tidal_sweep"
      ) {
        multiplier *= 1.5;
      }
      // Protection to stabilize
      else if (
        abilityName === "jormungandr_shell" ||
        abilityName === "baldr_immune"
      ) {
        multiplier *= 1.3;
      }
    }

    // === WINNING POSITION ===
    else if (boardPosition === 'winning') {
      // Consolidation and protection
      if (
        abilityName === "jormungandr_shell" ||
        abilityName === "kamohoalii_oceans_shield" ||
        abilityName === "baldr_immune"
      ) {
        multiplier *= 1.4;
      }
      // Buff allies to maintain advantage
      else if (
        abilityName === "odin_foresight" ||
        abilityName === "frigg_bless"
      ) {
        multiplier *= 1.3;
      }
      // Recurring effects to build momentum
      else if (
        abilityName === "hachiman_warriors_aura" ||
        abilityName === "futakuchi_onna_vengeful_bite" ||
        abilityName === "tsukuyomi_moons_balance"
      ) {
        multiplier *= 1.3;
      }
      // Comeback mechanics are less valuable
      else if (
        abilityName === "vali_revenge" ||
        abilityName === "ku_war_stance"
      ) {
        multiplier *= 0.6;
      }
    }

    // === EVEN POSITION ===
    else if (boardPosition === 'even') {
      // Everything at standard value, but slight boost to versatile abilities
      if (
        abilityName === "sleipnir_swift_messenger" ||
        abilityName === "susanoo_storm_breaker" ||
        abilityName === "odin_foresight"
      ) {
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
    if (abilityName === "sleipnir_swift_messenger") {
      score += AI_CONFIG.MOVE_EVALUATION.DRAW_CARD_VALUE * 2;
    } else if (abilityName === "verdandi_present") {
      score += AI_CONFIG.MOVE_EVALUATION.DRAW_CARD_VALUE;
    }

    // === INVINCIBILITY/PROTECTION ABILITIES (Extremely High Defensive Value) ===
    else if (abilityName === "jormungandr_shell") {
      // Can only be defeated by Thor - nearly invincible
      score += AI_CONFIG.MOVE_EVALUATION.PROTECTION_VALUE * 2.5;
    } else if (abilityName === "baldr_immune") {
      // Cannot be defeated by special abilities
      score += AI_CONFIG.MOVE_EVALUATION.PROTECTION_VALUE * 1.8;
    } else if (abilityName === "kamohoalii_oceans_shield") {
      // Cannot be defeated by enemies with lower total power
      score += AI_CONFIG.MOVE_EVALUATION.PROTECTION_VALUE * 1.5;
    } else if (abilityName === "kaahupahau_harbor_guardian") {
      // Sacrifices power to protect allies - high utility
      score += AI_CONFIG.MOVE_EVALUATION.PROTECTION_VALUE * (allAllies.length > 2 ? 1.5 : 0.8);
    }

    // === GLOBAL BUFF/DEBUFF ABILITIES ===
    else if (abilityName === "odin_foresight") {
      // Permanent +1 to all allies
      score += allAllies.length * AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE * 2; // Permanent buff
    } else if (abilityName === "thor_push") {
      // Debuff all enemies
      score += allEnemies.length * AI_CONFIG.MOVE_EVALUATION.DEBUFF_ENEMY_VALUE;
    } else if (abilityName === "tyr_binding_justice") {
      // Equalizes power - great when opponent has strong cards
      const hasStrongEnemies = allEnemies.some((e) => getCardTotalPower(e) > 20);
      score += hasStrongEnemies ? AI_CONFIG.MOVE_EVALUATION.FLIP_ENEMY_VALUE * 2 : 50;
    } else if (abilityName === "heimdall_block") {
      // After 3 rounds: -1 to played cards, +1 to hand cards
      // Value depends on having more disposable cards on board than opponent
      const boardAdvantage = allEnemies.length > allAllies.length;
      score += boardAdvantage ? 100 : 40;
    }

    // === DESTRUCTION/REMOVAL ABILITIES ===
    else if (abilityName === "susanoo_storm_breaker") {
      // Destroys strongest enemy Beast/Dragon, gains +2
      const hasTargetTag = allEnemies.some((e) => 
        e.base_card_data.tags.includes("Beast") || e.base_card_data.tags.includes("Dragon")
      );
      score += hasTargetTag ? AI_CONFIG.MOVE_EVALUATION.FLIP_ENEMY_VALUE * 2 : 30;
    } else if (abilityName === "surtr_flames") {
      // Destroys strongest adjacent enemy, -1 to others
      score += adjacentEnemies.length > 0 ? AI_CONFIG.MOVE_EVALUATION.FLIP_ENEMY_VALUE * 1.5 : 0;
    } else if (abilityName === "ryujin_tidal_sweep") {
      // Defeats enemies diagonally if lower total power
      score += AI_CONFIG.MOVE_EVALUATION.FLIP_ENEMY_VALUE * 0.8;
    } else if (abilityName === "fenrir_devourer_surge") {
      // Destroys weaker adjacent enemy each round, gains +1
      score += adjacentEnemies.length > 0 ? AI_CONFIG.MOVE_EVALUATION.FLIP_ENEMY_VALUE * 2 : 60;
    }

    // === COMEBACK/SCALING ABILITIES ===
    else if (abilityName === "vali_revenge") {
      // +1 to all stats per ally defeated
      score += defeatedAlliesCount * AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE * 2;
    } else if (abilityName === "ku_war_stance") {
      // Gains +1 per ally defeated (max 5), then attacks again
      score += defeatedAlliesCount * AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE * 1.5;
      if (defeatedAlliesCount >= 3) score += AI_CONFIG.MOVE_EVALUATION.FLIP_ENEMY_VALUE; // Double attack value
    } else if (abilityName === "urd_past_weaves") {
      // +1 to all stats per destroyed ally
      score += defeatedAlliesCount * AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE * 1.5;
    } else if (abilityName === "vidar_vengeance") {
      // +3 to all stats if Odin defeated - conditional powerhouse
      // TODO: Check if Odin is defeated
      score += 50; // Base value, would be much higher if condition met
    }

    // === ADJACENCY-BASED BUFFS (Permanent) ===
    else if (abilityName === "frigg_bless") {
      // Permanent +1 to adjacent allies
      score += adjacentAllies.length * AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE * 2;
    } else if (abilityName === "gunnr_war") {
      // Temporary +1 to adjacent allies
      score += adjacentAllies.length * AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE;
    } else if (abilityName === "bragi_inspire") {
      // Temporary +1 to adjacent allies for a round
      score += adjacentAllies.length * AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE;
    } else if (abilityName === "freyja_bless") {
      // Temporary +2 to adjacent allies
      score += adjacentAllies.length * AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE * 1.5;
    } else if (abilityName === "momotaro_allies_rally") {
      // Temporary +1 to adjacent allies
      score += adjacentAllies.length * AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE;
    }

    // === CONDITIONAL POWER BOOSTS ===
    else if (abilityName === "njord_sea") {
      // +3 if adjacent to Sea card
      const hasSeaAdjacent = adjacentAllies.some((c) => c.base_card_data.tags.includes("Sea"));
      score += hasSeaAdjacent ? AI_CONFIG.MOVE_EVALUATION.SYNERGY_BONUS * 2 : 20;
    } else if (abilityName === "brynhildr_valk") {
      // +2 if adjacent to Valkyrie
      const hasValkyrieAdjacent = adjacentAllies.some((c) => c.base_card_data.tags.includes("Valkyrie"));
      score += hasValkyrieAdjacent ? AI_CONFIG.MOVE_EVALUATION.SYNERGY_BONUS * 1.5 : 15;
    } else if (abilityName === "hrungnir_worthy") {
      // +1 to all if adjacent to Thor
      const hasThorAdjacent = adjacentAllies.some((c) => c.base_card_data.name === "Thor");
      score += hasThorAdjacent ? AI_CONFIG.MOVE_EVALUATION.SYNERGY_BONUS : 15;
    } else if (abilityName === "thrym_demand") {
      // +3 Right if adjacent to Goddess
      const hasGoddessAdjacent = adjacentAllies.some((c) => c.base_card_data.tags.includes("Goddess"));
      score += hasGoddessAdjacent ? AI_CONFIG.MOVE_EVALUATION.SYNERGY_BONUS * 1.5 : 10;
    } else if (abilityName === "freyr_peace") {
      // +2 if no adjacent enemies
      score += adjacentEnemies.length === 0 ? AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE * 1.5 : 0;
    } else if (abilityName === "ymir_isolation") {
      // +2 to all if no adjacent cards
      score += adjacentCards.length === 0 ? AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE * 2 : 0;
    } else if (abilityName === "ushi_oni_shore_fury") {
      // +2 if on edge
      const isEdge = position.x === 0 || position.x === 3 || position.y === 0 || position.y === 3;
      score += isEdge ? AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE * 1.5 : 0;
    } else if (abilityName === "benkei_steadfast_guard") {
      // +1 per adjacent enemy
      score += adjacentEnemies.length * AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE;
    } else if (abilityName === "kintaro_beast_friend") {
      // Gains +1 per adjacent enemy stronger than self
      const strongerEnemies = adjacentEnemies.filter((e) => getCardTotalPower(e) > getCardTotalPower(card));
      score += strongerEnemies.length * AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE * 1.5;
    }

    // === TRIBAL/TAG-BASED ABILITIES ===
    else if (abilityName === "sigurd_slayer") {
      // +1 per Dragon on board
      const dragonCount = [...allAllies, ...allEnemies].filter((c) => c.base_card_data.tags.includes("Dragon")).length;
      score += dragonCount * AI_CONFIG.MOVE_EVALUATION.SYNERGY_BONUS;
    } else if (abilityName === "minamoto_demon_bane") {
      // Gains +1 when any demon defeated
      const hasDemon = allEnemies.some((c) => c.base_card_data.tags.includes("Demon"));
      score += hasDemon ? AI_CONFIG.MOVE_EVALUATION.SYNERGY_BONUS : 20;
    }

    // === DEBUFF ABILITIES ===
    else if (abilityName === "yuki_onna_frost_row") {
      // Enemies in row lose 1 temporarily
      score += cardsInRow.length * AI_CONFIG.MOVE_EVALUATION.DEBUFF_ENEMY_VALUE;
    } else if (abilityName === "tawara_piercing_shot") {
      // Enemies in column permanently lose 1
      score += cardsInColumn.length * AI_CONFIG.MOVE_EVALUATION.DEBUFF_ENEMY_VALUE * 2;
    } else if (abilityName === "yamata_many_heads") {
      // -1 to enemies in row or column
      score += (cardsInRow.length + cardsInColumn.length) * AI_CONFIG.MOVE_EVALUATION.DEBUFF_ENEMY_VALUE * 0.5;
    } else if (abilityName === "gashadokuro_bone_chill") {
      // Adjacent enemies lose 1
      score += adjacentEnemies.length * AI_CONFIG.MOVE_EVALUATION.DEBUFF_ENEMY_VALUE;
    } else if (abilityName === "poliahu_icy_presence") {
      // Adjacent enemies permanently lose 1
      score += adjacentEnemies.length * AI_CONFIG.MOVE_EVALUATION.DEBUFF_ENEMY_VALUE * 2;
    } else if (abilityName === "fafnir_venom") {
      // Strongest adjacent enemy loses 2
      score += adjacentEnemies.length > 0 ? AI_CONFIG.MOVE_EVALUATION.DEBUFF_ENEMY_VALUE * 2 : 0;
    } else if (abilityName === "futakuchi_onna_vengeful_bite") {
      // -1 to adjacent enemies each round
      score += adjacentEnemies.length * AI_CONFIG.MOVE_EVALUATION.DEBUFF_ENEMY_VALUE * 1.5;
    }

    // === TERRAIN/TILE MANIPULATION ===
    else if (abilityName === "skadi_freeze") {
      // Freeze adjacent tile for 1 turn
      score += AI_CONFIG.MOVE_EVALUATION.TILE_MANIPULATION_VALUE * emptyAdjacent;
    } else if (abilityName === "jorogumo_web_curse") {
      // Curse adjacent tiles, drain power for 1 round
      score += emptyAdjacent * AI_CONFIG.MOVE_EVALUATION.TILE_MANIPULATION_VALUE * 2;
    } else if (abilityName === "kapo_hex_field") {
      // Curse empty adjacent tiles
      score += emptyAdjacent * AI_CONFIG.MOVE_EVALUATION.TILE_MANIPULATION_VALUE;
    } else if (abilityName === "kamapuaa_wild_shift") {
      // Create lava every round
      score += AI_CONFIG.MOVE_EVALUATION.TILE_MANIPULATION_VALUE * 2; // Recurring effect
    } else if (abilityName === "pele_lava_field") {
      // Gains +1 per card played on lava
      score += AI_CONFIG.MOVE_EVALUATION.TILE_MANIPULATION_VALUE * 1.5; // Scaling value
    } else if (abilityName === "hauwahine_rains_blessing") {
      // Fill tile with water, allies placed after gain +1
      score += AI_CONFIG.MOVE_EVALUATION.TILE_MANIPULATION_VALUE * 2;
    } else if (abilityName === "kane_pure_waters") {
      // Fill tile with water, cleanse all allies
      score += AI_CONFIG.MOVE_EVALUATION.TILE_MANIPULATION_VALUE + (allAllies.length * 20);
    } else if (abilityName === "mooinanea_sacred_spring") {
      // On water: bless ally and cleanse adjacent allies each round
      score += AI_CONFIG.MOVE_EVALUATION.TILE_MANIPULATION_VALUE * 2;
    } else if (abilityName === "ukupanipo_feast_or_famine") {
      // When ally defeated, fill tile with water
      score += AI_CONFIG.MOVE_EVALUATION.TILE_MANIPULATION_VALUE;
    }

    // === UTILITY/CLEANSING ===
    else if (abilityName === "hiaka_cleansing_hula") {
      // Cleanse random ally each round
      score += allAllies.length > 0 ? AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE * 0.8 : 20;
    } else if (abilityName === "eir_heal") {
      // Cleanse adjacent allies
      score += adjacentAllies.length * AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE * 0.5;
    } else if (abilityName === "nopperabo_erase_face") {
      // Remove all buffs from adjacent enemies
      score += adjacentEnemies.length * AI_CONFIG.MOVE_EVALUATION.DEBUFF_ENEMY_VALUE * 0.8;
    } else if (abilityName === "urashima_time_shift") {
      // Remove temporary buffs from enemy in column
      score += cardsInColumn.length > 0 ? AI_CONFIG.MOVE_EVALUATION.DEBUFF_ENEMY_VALUE : 20;
    }

    // === POSITIONAL MANIPULATION ===
    else if (abilityName === "laamaomao_gale_aura") {
      // Push adjacent enemies away
      score += adjacentEnemies.length * AI_CONFIG.MOVE_EVALUATION.BOARD_CONTROL_VALUE;
    } else if (abilityName === "ran_pull") {
      // Pull enemy cards closer before combat
      score += AI_CONFIG.MOVE_EVALUATION.BOARD_CONTROL_VALUE * 1.5;
    }

    // === REACTIVE/TRIGGER ABILITIES ===
    else if (abilityName === "okuriinu_hunters_mark") {
      // When ally defeated, drain -1 from attacker
      score += allAllies.length * AI_CONFIG.MOVE_EVALUATION.DEBUFF_ENEMY_VALUE * 0.5;
    } else if (abilityName === "milu_spirit_bind") {
      // If defeated, attacker loses 1 permanently
      score += AI_CONFIG.MOVE_EVALUATION.DEBUFF_ENEMY_VALUE * 1.5;
    } else if (abilityName === "amaterasu_radiant_blessing") {
      // When ally defeated, +1 to random ally
      score += AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE * 0.8;
    } else if (abilityName === "hel_soul") {
      // Enemies Hel defeats become permanent allies
      score += AI_CONFIG.MOVE_EVALUATION.FLIP_ENEMY_VALUE * 3; // Very powerful
    }

    // === RECURRING EFFECTS ===
    else if (abilityName === "hachiman_warriors_aura") {
      // +1 to allies in same row each round
      const alliesInRow = getAlliesAdjacentTo(position, board, aiPlayerId).filter(a => 
        getCardsInSameRow(position, board, aiPlayerId).includes(a)
      );
      score += alliesInRow.length * AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE * 1.5;
    } else if (abilityName === "tsukuyomi_moons_balance") {
      // Each round: -1 to strongest enemy, +1 to weakest ally
      score += allEnemies.length > 0 ? AI_CONFIG.MOVE_EVALUATION.DEBUFF_ENEMY_VALUE * 1.5 : 40;
    } else if (abilityName === "lono_fertile_ground") {
      // Each round grant +1 to allies with blessings
      score += allAllies.length * AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE * 0.5;
    } else if (abilityName === "nurarihyon_slipstream") {
      // Each round steal blessing from random enemy
      score += allEnemies.length > 0 ? 60 : 20;
    }

    // === SPECIAL MECHANICS ===
    else if (abilityName === "loki_flip") {
      // 50% chance to flip 4 random cards
      score += AI_CONFIG.MOVE_EVALUATION.FLIP_ENEMY_VALUE * 0.8; // High risk/reward
    } else if (abilityName === "yamabiko_echo_power") {
      // Matches highest adjacent card power this turn
      score += adjacentCards.length > 0 ? AI_CONFIG.MOVE_EVALUATION.BUFF_ALLY_VALUE * 1.5 : 20;
    } else if (abilityName === "nightmarchers_dread_aura") {
      // Enemy abilities disabled next turn
      score += allEnemies.length * 30;
    } else if (abilityName === "kanehekili_thunderous_omen") {
      // Random enemy loses random power
      score += allEnemies.length > 0 ? AI_CONFIG.MOVE_EVALUATION.DEBUFF_ENEMY_VALUE * 0.5 : 20;
    }

    // === HAND-SCALING ABILITIES (These should often be HELD, not played immediately) ===
    // Note: These get special treatment in hand-hold evaluation
    else if (abilityName === "maui_sun_trick") {
      // Gains +1 in hand each round, resets after combat
      // Base score is low - should be evaluated for holding
      score += 40;
    } else if (abilityName === "kanaloa_tide_ward") {
      // While in hand: +1 to each played card. When played: steal blessings
      // Should usually be held
      score += 50;
    } else if (abilityName === "kane_pure_waters") {
      // Gains +1 in hand per blessed tile (max 5)
      score += 45;
    }

    // === DUAL ASPECT & SYNERGY ABILITIES ===
    else if (abilityName === "kupua_dual_aspect") {
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
          TriggerMoment.AnyOnPlace
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
      "sleipnir_swift_messenger", // Draw 2
      "susanoo_storm_breaker", // Auto defeat
      "surtr_flames", // Destroy strongest
      "odin_foresight", // Buff all allies
      "jormungandr_shell", // Nearly invincible
      "baldr_immune", // Ability immune
    ];

    return highImpactAbilities.includes(
      card.base_card_data.special_ability.id ??
        card.base_card_data.special_ability.ability_id ??
        ""
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

    const abilityName =
      card.base_card_data.special_ability.id ??
      card.base_card_data.special_ability.ability_id ??
      "";
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
    if (abilityName === "maui_sun_trick") {
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
    } else if (abilityName === "kane_pure_waters") {
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
    } else if (abilityName === "kanaloa_tide_ward") {
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

    if (
      abilityName === "vali_revenge" ||
      abilityName === "ku_war_stance" ||
      abilityName === "urd_past_weaves"
    ) {
      // These get stronger as allies are defeated
      if (defeatedAlliesCount < 3) {
        holdValue += 100 - (defeatedAlliesCount * 25); // Hold until more allies defeated
      } else {
        holdValue -= 80; // Powerful now, play it!
      }
    } else if (abilityName === "vidar_vengeance") {
      // Only powerful if Odin is defeated
      // TODO: Check if Odin is defeated
      // For now, hold it until late game
      const totalCardsPlayed = [...gameState.board.flat()].filter(cell => cell?.card).length;
      if (totalCardsPlayed < 8) {
        holdValue += 120; // Hold until condition might be met
      }
    }

    // === CONDITIONAL POWERHOUSES (Hold until condition met) ===
    if (abilityName === "susanoo_storm_breaker") {
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
    } else if (abilityName === "tyr_binding_justice") {
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
    if (
      abilityName === "sleipnir_swift_messenger" ||
      abilityName === "verdandi_present"
    ) {
      const cardsInHand = aiPlayer.hand.length;
      if (cardsInHand <= 2) {
        holdValue -= 120; // Low hand, play immediately for draw
      } else {
        holdValue -= 40; // Still valuable but less urgent
      }
    }

    // === TERRAIN SETUP CARDS (Play early) ===
    if (
      abilityName === "kamapuaa_wild_shift" ||
      abilityName === "hauwahine_rains_blessing" ||
      abilityName === "ukupanipo_feast_or_famine"
    ) {
      const totalCardsPlayed = [...gameState.board.flat()].filter(cell => cell?.card).length;
      if (totalCardsPlayed > 8) {
        holdValue += 50; // Late game, hold for better timing
      } else {
        holdValue -= 80; // Early game, play for setup
      }
    }

    // === INVINCIBILITY CARDS (Play when you need to lock down position) ===
    if (
      abilityName === "jormungandr_shell" ||
      abilityName === "kamohoalii_oceans_shield" ||
      abilityName === "baldr_immune"
    ) {
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
