import { GameLogic } from "./game.logic";
import { GameState, BoardPosition } from "../types/game.types";
import { InGameCard } from "../types/card.types";
import * as _ from "lodash";
import * as validators from "./game.validators";
import { GAME_CONFIG, AI_CONFIG } from "../config/constants";
import { AbilityAnalyzer } from "./ai.ability-analyzer";
import { StrategicEvaluator } from "./ai.strategic-evaluator";
import { LookaheadEngine } from "./ai.lookahead";

interface DifficultyWeights {
  IMMEDIATE_FLIPS: number;
  CARD_POWER: number;
  ABILITY_IMPACT: number;
  POSITIONAL: number;
  FUTURE_POTENTIAL: number;
  RANDOMNESS: number;
}

export class AILogic {
  private abilityAnalyzer: AbilityAnalyzer;
  private strategicEvaluator: StrategicEvaluator;
  private lookaheadEngine: LookaheadEngine;

  constructor() {
    this.abilityAnalyzer = new AbilityAnalyzer();
    this.strategicEvaluator = new StrategicEvaluator();
    this.lookaheadEngine = new LookaheadEngine();
  }

  /**
   * Enhanced move evaluation with ability awareness and strategic positioning
   */
  evaluateMove(
    gameState: GameState,
    cardToPlay: InGameCard,
    position: BoardPosition,
    aiPlayerId: string,
    difficulty: string = "medium"
  ): number {
    let score = 0;

    // Get difficulty weights
    const weights = this.getDifficultyWeights(difficulty);

    // 1. Evaluate immediate flips (traditional scoring)
    const flipScore = this.evaluateImmediateFlips(
      gameState,
      cardToPlay,
      position,
      aiPlayerId
    );
    score += flipScore * weights.IMMEDIATE_FLIPS;

    // 2. Evaluate card power value
    const powerScore =
      cardToPlay.current_power.top +
      cardToPlay.current_power.right +
      cardToPlay.current_power.bottom +
      cardToPlay.current_power.left;
    score += powerScore * weights.CARD_POWER;

    // 3. Evaluate ability impact (NEW!)
    const abilityScore = this.abilityAnalyzer.evaluateAbilityImpact(
      gameState,
      cardToPlay,
      position,
      aiPlayerId
    );
    score += abilityScore * weights.ABILITY_IMPACT;

    // 4. Evaluate ability chains (NEW!)
    const chainScore = this.abilityAnalyzer.evaluateAbilityChains(
      gameState,
      cardToPlay,
      position,
      aiPlayerId
    );
    score += chainScore * weights.ABILITY_IMPACT;

    // 5. Evaluate strategic positioning (NEW!)
    const strategicScore = this.strategicEvaluator.evaluateStrategicPosition(
      gameState,
      cardToPlay,
      position,
      aiPlayerId
    );
    score += strategicScore * weights.POSITIONAL;

    // 6. Evaluate blocking value (NEW!)
    const blockingScore = this.strategicEvaluator.evaluateBlockingValue(
      gameState,
      position,
      aiPlayerId
    );
    score += blockingScore * weights.POSITIONAL;

    // 7. Evaluate future potential (NEW!)
    const futureScore = this.strategicEvaluator.evaluateFuturePotential(
      gameState,
      position,
      aiPlayerId
    );
    score += futureScore * weights.FUTURE_POTENTIAL;

    // 8. Add randomness factor for lower difficulties
    if (weights.RANDOMNESS > 0) {
      const randomFactor = (Math.random() - 0.5) * 2; // -1 to 1
      score += randomFactor * score * weights.RANDOMNESS;
    }

    return score;
  }

  /**
   * Traditional flip evaluation (kept for backward compatibility and baseline)
   */
  private evaluateImmediateFlips(
    gameState: GameState,
    cardToPlay: InGameCard,
    position: BoardPosition,
    aiPlayerId: string
  ): number {
    let score = 0;
    const tempBoard = _.cloneDeep(gameState.board);

    tempBoard[position.y][position.x] = {
      card: cardToPlay,
      tile_enabled: true,
    };

    let potentialFlips = 0;
    const directions = [
      { dx: 0, dy: -1, from: "bottom", to: "top" },
      { dx: 1, dy: 0, from: "left", to: "right" },
      { dx: 0, dy: 1, from: "top", to: "bottom" },
      { dx: -1, dy: 0, from: "right", to: "left" },
    ];

    for (const dir of directions) {
      const nx = position.x + dir.dx;
      const ny = position.y + dir.dy;

      if (
        nx >= 0 &&
        nx < GAME_CONFIG.BOARD_SIZE &&
        ny >= 0 &&
        ny < GAME_CONFIG.BOARD_SIZE &&
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

    score += potentialFlips * AI_CONFIG.MOVE_EVALUATION.FLIP_BONUS;

    return score;
  }

  /**
   * Gets difficulty-specific weights for evaluation components
   */
  private getDifficultyWeights(difficulty: string): DifficultyWeights {
    const difficultyUpper = difficulty.toUpperCase();

    if (difficultyUpper === "EASY") {
      return AI_CONFIG.DIFFICULTY_WEIGHTS.EASY;
    } else if (difficultyUpper === "HARD") {
      return AI_CONFIG.DIFFICULTY_WEIGHTS.HARD;
    } else {
      return AI_CONFIG.DIFFICULTY_WEIGHTS.MEDIUM;
    }
  }

  /**
   * Gets lookahead depth based on difficulty
   */
  private getLookaheadDepth(difficulty: string): number {
    const difficultyUpper = difficulty.toUpperCase();

    if (difficultyUpper === "EASY") {
      return AI_CONFIG.LOOKAHEAD.EASY_DEPTH;
    } else if (difficultyUpper === "HARD") {
      return AI_CONFIG.LOOKAHEAD.HARD_DEPTH;
    } else {
      return AI_CONFIG.LOOKAHEAD.MEDIUM_DEPTH;
    }
  }

  /**
   * Main AI move selection with difficulty-based strategy
   */
  async makeAIMove(
    currentGameState: GameState,
    aiDifficulty = "medium"
  ): Promise<{
    action_type: string;
    user_card_instance_id: string;
    position: BoardPosition;
  } | null> {
    const startTime = Date.now();

    const aiPlayer = currentGameState.player1.user_id.startsWith("AI_")
      ? currentGameState.player1
      : currentGameState.player2;

    if (aiPlayer.hand.length === 0) return null;

    // Phase 1: Generate and evaluate all possible moves
    let possibleMoves: {
      user_card_instance_id: string;
      position: BoardPosition;
      score: number;
      card?: InGameCard;
    }[] = [];

    for (const instanceIdInHand of aiPlayer.hand) {
      // Get hydrated card data
      let cardData =
        currentGameState.hydrated_card_data_cache?.[instanceIdInHand];

      if (!cardData) {
        const fetchedCard = (
          await GameLogic.hydrateCardInstances([instanceIdInHand])
        ).get(instanceIdInHand);
        if (!fetchedCard) continue;
        cardData = fetchedCard;
      }

      // Evaluate if this card should be held in hand
      const holdValue = this.abilityAnalyzer.evaluateHandHoldValue(
        currentGameState,
        cardData as InGameCard,
        aiPlayer.user_id
      );

      // If hold value is very high and we have other cards, skip evaluating this card for placement
      if (holdValue > 100 && aiPlayer.hand.length > 1) {
        continue; // Hold this card, don't consider playing it
      }

      // Evaluate each valid position
      for (let y = 0; y < GAME_CONFIG.BOARD_SIZE; y++) {
        for (let x = 0; x < GAME_CONFIG.BOARD_SIZE; x++) {
          const placeResult = validators.canPlaceOnTile(currentGameState, {
            x,
            y,
          });

          if (placeResult.canPlace) {
            const baseScore = this.evaluateMove(
              _.cloneDeep(currentGameState),
              cardData as InGameCard,
              { x, y },
              aiPlayer.user_id,
              aiDifficulty
            );

            // Adjust score based on hold value
            // Negative hold value means "play it now" and boosts the score
            // Positive hold value means "consider holding" and reduces the score
            const adjustedScore = baseScore - holdValue * 0.5;

            possibleMoves.push({
              user_card_instance_id: instanceIdInHand,
              position: { x, y },
              score: adjustedScore,
              card: cardData as InGameCard,
            });
          }
        }
      }
    }

    if (possibleMoves.length === 0) return null;

    // Phase 2: Apply lookahead for higher difficulties
    const lookaheadDepth = this.getLookaheadDepth(aiDifficulty);

    if (lookaheadDepth > 0) {
      this.lookaheadEngine.startTiming();

      // Sort and only evaluate top candidates with lookahead (performance optimization)
      possibleMoves.sort((a, b) => b.score - a.score);
      const topCandidates = possibleMoves.slice(
        0,
        Math.min(10, possibleMoves.length)
      );

      for (const move of topCandidates) {
        const lookaheadScore = await this.lookaheadEngine.evaluateWithLookahead(
          currentGameState,
          move.user_card_instance_id,
          move.position,
          aiPlayer.user_id,
          lookaheadDepth,
          move.score
        );

        move.score = lookaheadScore;

        // Time check - if running out of time, break
        const elapsed = Date.now() - startTime;
        if (elapsed > AI_CONFIG.LOOKAHEAD.MAX_TIME_MS * 0.8) {
          break;
        }
      }

      const stats = this.lookaheadEngine.getStats();
    }

    // Phase 3: Select move based on difficulty
    possibleMoves.sort((a, b) => b.score - a.score);

    const topN = Math.min(
      possibleMoves.length,
      aiDifficulty === AI_CONFIG.DIFFICULTY_LEVELS.HARD
        ? AI_CONFIG.MOVE_SELECTION.HARD_TOP_MOVES
        : aiDifficulty === AI_CONFIG.DIFFICULTY_LEVELS.MEDIUM
        ? AI_CONFIG.MOVE_SELECTION.MEDIUM_TOP_MOVES
        : AI_CONFIG.MOVE_SELECTION.EASY_TOP_MOVES
    );

    const chosenMove = possibleMoves[Math.floor(Math.random() * topN)];

    return {
      action_type: "placeCard",
      user_card_instance_id: chosenMove.user_card_instance_id,
      position: chosenMove.position,
    };
  }
}
