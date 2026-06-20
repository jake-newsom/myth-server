import { GameLogic } from "./game.logic";
import { GameState, BoardPosition } from "../types/game.types";
import { InGameCard } from "../types/card.types";
import * as validators from "./game.validators";
import { GAME_CONFIG, AI_CONFIG } from "../config/constants";
import { AbilityAnalyzer } from "./ai.ability-analyzer";
import { AbilityRuleEngine } from "./ai.rules.engine";
import { StrategicEvaluator } from "./ai.strategic-evaluator";
import { AITelemetry } from "./ai.telemetry";
import { LookaheadEngine } from "./ai.lookahead";
import { UnifiedScoreV2 } from "./ai.unified-score";
import { randomFloat, randomInt } from "./simulation.rng";

interface DifficultyWeights {
  IMMEDIATE_FLIPS: number;
  CARD_POWER: number;
  ABILITY_IMPACT: number;
  POSITIONAL: number;
  FUTURE_POTENTIAL: number;
  RANDOMNESS: number;
}

type OpponentArchetype =
  | "terrain"
  | "buff"
  | "debuff"
  | "flip"
  | "destroy"
  | "combo"
  | "balanced";

type ArchetypeScoreBuckets = Record<
  Exclude<OpponentArchetype, "balanced">,
  number
>;

interface OpponentArchetypeProfile {
  primary: OpponentArchetype;
  confidence: number;
  scores: ArchetypeScoreBuckets;
}

export class AILogic {
  private abilityAnalyzer: AbilityAnalyzer;
  private strategicEvaluator: StrategicEvaluator;
  private lookaheadEngine: LookaheadEngine;
  private abilityRuleEngine: AbilityRuleEngine;
  private unifiedScoreV2: UnifiedScoreV2;

  constructor() {
    this.abilityAnalyzer = new AbilityAnalyzer();
    this.strategicEvaluator = new StrategicEvaluator();
    this.lookaheadEngine = new LookaheadEngine();
    this.abilityRuleEngine = new AbilityRuleEngine();
    this.unifiedScoreV2 = new UnifiedScoreV2(
      this.abilityAnalyzer,
      this.strategicEvaluator,
      this.abilityRuleEngine
    );
  }

  private getOpponentPlayer(gameState: GameState, aiPlayerId: string) {
    return gameState.player1.user_id === aiPlayerId
      ? gameState.player2
      : gameState.player1;
  }

  /**
   * Detects whether the opponent has Ka'ahupahau in a fortress position:
   * on the board with no adjacent AI cards (unreachable or nearly so).
   * Returns the board position of Ka'ah if in fortress, null otherwise.
   */
  private findEnemyKaahFortress(
    gameState: GameState,
    aiPlayerId: string
  ): BoardPosition | null {
    for (let y = 0; y < GAME_CONFIG.BOARD_SIZE; y++) {
      for (let x = 0; x < GAME_CONFIG.BOARD_SIZE; x++) {
        const cell = gameState.board[y]?.[x];
        if (!cell?.card || cell.card.owner === aiPlayerId) continue;
        const abilityId =
          cell.card.base_card_data.special_ability?.id ??
          cell.card.base_card_data.special_ability?.ability_id ??
          "";
        if (abilityId !== "kaahupahau_harbor_guardian") continue;

        // Check if any adjacent cell has an AI card (meaning Ka'ah is already contested)
        const directions = [
          { dx: 0, dy: -1 }, { dx: 1, dy: 0 },
          { dx: 0, dy: 1 }, { dx: -1, dy: 0 },
        ];
        const adjacentAICard = directions.some(({ dx, dy }) => {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= GAME_CONFIG.BOARD_SIZE || ny < 0 || ny >= GAME_CONFIG.BOARD_SIZE) {
            return false;
          }
          const neighbor = gameState.board[ny]?.[nx];
          return neighbor?.card?.owner === aiPlayerId;
        });

        if (!adjacentAICard) {
          return { x, y }; // Ka'ah is in fortress
        }
      }
    }
    return null;
  }

  private scoreArchetypeSignals(
    card: InGameCard,
    buckets: ArchetypeScoreBuckets
  ): void {
    const ability = card.base_card_data.special_ability;
    const text = [
      ability?.id ?? "",
      ability?.name ?? "",
      ability?.description ?? "",
      ...(card.base_card_data.tags ?? []),
    ]
      .join(" ")
      .toLowerCase();

    if (/(terrain|tile|ocean|water|lava)/.test(text)) {
      buckets.terrain += 2.2;
    }
    if (/(buff|boost|gain|bless|empower|enhance)/.test(text)) {
      buckets.buff += 1.4;
    }
    if (/(debuff|curse|weaken|reduce|lose|strip|remove buffs?)/.test(text)) {
      buckets.debuff += 1.7;
    }
    if (/(flip|capture|turn enemy)/.test(text)) {
      buckets.flip += 1.3;
    }
    if (/(destroy|defeat|devour|kill|banish)/.test(text)) {
      buckets.destroy += 2.0;
    }
    if (/(adjacent|ally|same set|tribe|row|column|combo|synergy)/.test(text)) {
      buckets.combo += 1.1;
    }
  }

  private detectOpponentArchetype(
    gameState: GameState,
    aiPlayerId: string
  ): OpponentArchetypeProfile {
    const opponent = this.getOpponentPlayer(gameState, aiPlayerId);
    const buckets: ArchetypeScoreBuckets = {
      terrain: 0,
      buff: 0,
      debuff: 0,
      flip: 0,
      destroy: 0,
      combo: 0,
    };
    const seen = new Set<string>();

    if (opponent.deck_effect === "polynesian") {
      buckets.terrain += 5;
    } else if (opponent.deck_effect === "japanese") {
      buckets.debuff += 5;
    } else if (opponent.deck_effect === "norse") {
      buckets.buff += 3;
      buckets.flip += 1;
    }

    const candidateIds = [
      ...opponent.hand,
      ...opponent.deck,
      ...opponent.discard_pile,
    ];
    for (const cardId of candidateIds) {
      if (seen.has(cardId)) continue;
      seen.add(cardId);
      const card = gameState.hydrated_card_data_cache?.[cardId];
      if (!card) continue;
      this.scoreArchetypeSignals(card, buckets);
    }

    for (const row of gameState.board) {
      for (const cell of row) {
        if (!cell.card || cell.card.owner === aiPlayerId) continue;
        this.scoreArchetypeSignals(cell.card, buckets);
      }
    }

    const ranked = Object.entries(buckets).sort((a, b) => b[1] - a[1]);
    const primaryScore = ranked[0]?.[1] ?? 0;
    const secondaryScore = ranked[1]?.[1] ?? 0;
    const confidence = primaryScore / (primaryScore + secondaryScore + 1);
    const primary =
      primaryScore < 3
        ? "balanced"
        : (ranked[0]?.[0] as OpponentArchetype | undefined) ?? "balanced";

    return {
      primary,
      confidence,
      scores: buckets,
    };
  }

  private countAdjacentEnemies(
    gameState: GameState,
    position: BoardPosition,
    aiPlayerId: string
  ): number {
    const directions = [
      { dx: 0, dy: -1 },
      { dx: 1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: -1, dy: 0 },
    ];
    let adjacentEnemyCount = 0;

    for (const dir of directions) {
      const nx = position.x + dir.dx;
      const ny = position.y + dir.dy;
      if (
        nx < 0 ||
        nx >= GAME_CONFIG.BOARD_SIZE ||
        ny < 0 ||
        ny >= GAME_CONFIG.BOARD_SIZE
      ) {
        continue;
      }
      const neighbor = gameState.board[ny][nx];
      if (neighbor?.card && neighbor.card.owner !== aiPlayerId) {
        adjacentEnemyCount++;
      }
    }

    return adjacentEnemyCount;
  }

  private getArchetypeAdjustment(
    profile: OpponentArchetypeProfile,
    gameState: GameState,
    cardToPlay: InGameCard,
    position: BoardPosition,
    aiPlayerId: string
  ): number {
    if (profile.primary === "balanced" || profile.confidence < 0.5) {
      return 0;
    }

    const abilityText = [
      cardToPlay.base_card_data.special_ability?.id ?? "",
      cardToPlay.base_card_data.special_ability?.name ?? "",
      cardToPlay.base_card_data.special_ability?.description ?? "",
      ...(cardToPlay.base_card_data.tags ?? []),
    ]
      .join(" ")
      .toLowerCase();
    const immediateFlips = this.countImmediateFlips(
      gameState,
      cardToPlay,
      position,
      aiPlayerId
    );
    const adjacentEnemyCount = this.countAdjacentEnemies(
      gameState,
      position,
      aiPlayerId
    );
    const cardPowerTotal =
      cardToPlay.current_power.top +
      cardToPlay.current_power.right +
      cardToPlay.current_power.bottom +
      cardToPlay.current_power.left;
    const isCorner =
      (position.x === 0 || position.x === GAME_CONFIG.BOARD_SIZE - 1) &&
      (position.y === 0 || position.y === GAME_CONFIG.BOARD_SIZE - 1);
    const isEdge =
      position.x === 0 ||
      position.x === GAME_CONFIG.BOARD_SIZE - 1 ||
      position.y === 0 ||
      position.y === GAME_CONFIG.BOARD_SIZE - 1;

    switch (profile.primary) {
      case "terrain": {
        const tile = gameState.board[position.y]?.[position.x];
        let score = 0;
        if (tile?.tile_effect?.terrain) score += 18;
        if (/(terrain|tile|ocean|water|lava)/.test(abilityText)) score += 12;
        if (adjacentEnemyCount >= 2) score += 4;
        return score * profile.confidence;
      }
      case "buff": {
        let score = immediateFlips * 16;
        if (/(debuff|remove buffs?|strip|erase|cleanse)/.test(abilityText)) {
          score += 14;
        }
        if (/(destroy|defeat)/.test(abilityText)) score += 8;
        return score * profile.confidence;
      }
      case "debuff": {
        let score = 0;
        if (/(cleanse|purify|block debuff|immune|invincible|shield|protect)/.test(abilityText)) {
          score += 16;
        }
        if (/(buff|boost|bless|gain)/.test(abilityText)) score += 8;
        score += Math.max(0, cardPowerTotal - 14) * 0.6;
        return score * profile.confidence;
      }
      case "flip": {
        let score = 0;
        if (isCorner) score += 12;
        else if (isEdge) score += 8;
        score += Math.max(0, cardPowerTotal - 15) * 0.75;
        return score * profile.confidence;
      }
      case "destroy": {
        let score = 0;
        if (adjacentEnemyCount >= 2) score -= 14;
        else if (adjacentEnemyCount === 0) score += 6;
        if (/(block defeat|protect|invincible|shield)/.test(abilityText)) {
          score += 10;
        }
        return score * profile.confidence;
      }
      case "combo": {
        let score = 0;
        if (/(debuff|destroy|defeat|flip|disable)/.test(abilityText)) score += 8;
        if (/(row|column|adjacent|terrain|tile)/.test(abilityText)) score += 6;
        if (isCorner || isEdge) score += 4;
        return score * profile.confidence;
      }
      default:
        return 0;
    }
  }

  /**
   * Extra score bonus when the opponent has Ka'ahupahau in a fortress position.
   * We want to prioritise moves that land adjacent to Ka'ah so we can drain her
   * power pool, or high-power cards that can survive her protection retaliation.
   */
  private getKaahFortressCounterBonus(
    gameState: GameState,
    cardToPlay: InGameCard,
    position: BoardPosition,
    aiPlayerId: string
  ): number {
    const kaahPos = this.findEnemyKaahFortress(gameState, aiPlayerId);
    if (!kaahPos) return 0;

    const distToKaah =
      Math.abs(position.x - kaahPos.x) + Math.abs(position.y - kaahPos.y);
    const cardPowerTotal =
      cardToPlay.current_power.top +
      cardToPlay.current_power.right +
      cardToPlay.current_power.bottom +
      cardToPlay.current_power.left;

    let bonus = 0;

    if (distToKaah === 1) {
      // Landing directly adjacent — ideal to start draining Ka'ah's power pool.
      // Only worth it if the card is strong enough to withstand her protection ability.
      if (cardPowerTotal >= 16) {
        bonus += 30;
      } else {
        bonus -= 20; // Weak card sacrificed to Ka'ah's protection
      }
    } else if (distToKaah === 2) {
      // One step away — setting up to reach Ka'ah next turn.
      bonus += 12;
    }

    // Cards with destroy/defeat abilities are ideal for dismantling a Ka'ah fortress.
    const abilityText = [
      cardToPlay.base_card_data.special_ability?.id ?? "",
      cardToPlay.base_card_data.special_ability?.description ?? "",
    ].join(" ").toLowerCase();
    if (/(destroy|defeat|devour|banish)/.test(abilityText) && distToKaah <= 2) {
      bonus += 18;
    }

    return bonus;
  }

  /**
   * Enhanced move evaluation with ability awareness and strategic positioning
   */
  evaluateMove(
    gameState: GameState,
    cardToPlay: InGameCard,
    position: BoardPosition,
    aiPlayerId: string,
    _difficulty: string = "medium"
  ): number {
    const effectiveDifficulty = AI_CONFIG.DIFFICULTY_LEVELS.HARD;
    const weights = this.getDifficultyWeights(effectiveDifficulty);

    const v2Enabled = AI_CONFIG.FEATURE_FLAGS.ENGINE_V2_ENABLED;
    const shadowMode =
      !v2Enabled && AI_CONFIG.FEATURE_FLAGS.ENGINE_V2_SHADOW_MODE;

    // The legacy path runs eight sub-evaluators. Only compute it when its result
    // is actually used (V2 disabled) or needed for shadow-mode drift logging.
    // When V2 is enabled and shadow mode is off, this would be pure waste.
    const needLegacy = !v2Enabled || shadowMode;
    const legacyScore = needLegacy
      ? this.evaluateMoveLegacy(
          gameState,
          cardToPlay,
          position,
          aiPlayerId,
          effectiveDifficulty
        )
      : 0;

    const v2Breakdown = this.unifiedScoreV2.scoreMove(
      gameState,
      cardToPlay,
      position,
      aiPlayerId
    );
    let v2Score =
      v2Breakdown.total +
      v2Breakdown.immediate_flips * (weights.IMMEDIATE_FLIPS - 1) +
      v2Breakdown.combo_value * (weights.ABILITY_IMPACT - 0.5) +
      v2Breakdown.board_control * (weights.POSITIONAL - 0.5);

    // Difficulty-specific stochasticity.
    if (weights.RANDOMNESS > 0) {
      const randomFactor = (randomFloat() - 0.5) * 2; // -1 to 1
      v2Score += randomFactor * v2Score * weights.RANDOMNESS;
    }

    // Shadow mode keeps legacy behavior but logs v2 drift.
    if (shadowMode) {
      const delta = v2Score - legacyScore;
      AITelemetry.logDecision({
        engineVersion: "v1",
        difficulty: effectiveDifficulty,
        playerId: aiPlayerId,
        elapsedMs: 0,
        totalCandidates: 1,
        evaluatedCandidates: 1,
        nodesEvaluated: 0,
        searchDepth: 0,
        topCandidates: [
          {
            user_card_instance_id: cardToPlay.user_card_instance_id,
            position,
            score: legacyScore,
          },
        ],
        notes: `shadow_delta=${delta.toFixed(2)}`,
      });
    }

    if (v2Enabled) {
      return v2Score;
    }

    return legacyScore;
  }

  /**
   * Legacy evaluation retained for shadow comparisons and fast rollback.
   */
  private evaluateMoveLegacy(
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
      const randomFactor = (randomFloat() - 0.5) * 2; // -1 to 1
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
    return (
      this.countImmediateFlips(gameState, cardToPlay, position, aiPlayerId) *
      AI_CONFIG.MOVE_EVALUATION.FLIP_BONUS
    );
  }

  private countImmediateFlips(
    gameState: GameState,
    cardToPlay: InGameCard,
    position: BoardPosition,
    aiPlayerId: string
  ): number {
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
        gameState.board[ny][nx] !== null &&
        gameState.board[ny][nx]!.card
      ) {
        const adjacentCell = gameState.board[ny][nx]!;
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

    return potentialFlips;
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
   * Main AI move selection with difficulty-based strategy.
   *
   * @param currentGameState The current game state
   * @param aiDifficulty Difficulty level for move evaluation
   * @param forPlayerId Optional: specific player ID to make move for (used in PvP timeout scenarios)
   */
  async makeAIMove(
    currentGameState: GameState,
    _aiDifficulty = "medium",
    forPlayerId?: string
  ): Promise<{
    action_type: string;
    user_card_instance_id: string;
    position: BoardPosition;
  } | null> {
    const startTime = Date.now();
    const effectiveDifficulty = AI_CONFIG.DIFFICULTY_LEVELS.HARD;

    // Determine which player to make a move for
    let aiPlayer;
    if (forPlayerId) {
      // PvP timeout scenario: use the specified player
      aiPlayer =
        currentGameState.player1.user_id === forPlayerId
          ? currentGameState.player1
          : currentGameState.player2;
    } else {
      // Solo game scenario: find the AI player by ID prefix
      aiPlayer = currentGameState.player1.user_id.startsWith("AI_")
        ? currentGameState.player1
        : currentGameState.player2;
    }

    if (aiPlayer.hand.length === 0) return null;
    const aiPlayerId = aiPlayer.user_id;
    const opponentArchetypeProfile = this.detectOpponentArchetype(
      currentGameState,
      aiPlayerId
    );

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
            // evaluateMove (and the scoring engines beneath it) only read from
            // game state and never mutate it, so no defensive clone is needed
            // here — cloning the whole state per candidate was pure overhead.
            const baseScore = this.evaluateMove(
              currentGameState,
              cardData as InGameCard,
              { x, y },
              aiPlayerId,
              effectiveDifficulty
            );

            // Adjust score based on hold value
            // Negative hold value means "play it now" and boosts the score
            // Positive hold value means "consider holding" and reduces the score
            const archetypeAdjustment = this.getArchetypeAdjustment(
              opponentArchetypeProfile,
              currentGameState,
              cardData as InGameCard,
              { x, y },
              aiPlayerId
            );
            const kaahCounterBonus = this.getKaahFortressCounterBonus(
              currentGameState,
              cardData as InGameCard,
              { x, y },
              aiPlayerId
            );
            const adjustedScore = baseScore - holdValue * 0.5 + archetypeAdjustment + kaahCounterBonus;

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
    const lookaheadDepth = this.getLookaheadDepth(effectiveDifficulty);

    if (lookaheadDepth > 0) {
      possibleMoves = await this.lookaheadEngine.reScoreCandidatesWithSearch(
        currentGameState,
        aiPlayerId,
        possibleMoves.map((move) => ({
          user_card_instance_id: move.user_card_instance_id,
          position: move.position,
          score: move.score,
        })),
        effectiveDifficulty,
        lookaheadDepth
      );
    }

    // Phase 3: Select move based on difficulty
    possibleMoves.sort((a, b) => b.score - a.score);

    const topN = Math.min(
      possibleMoves.length,
      effectiveDifficulty === AI_CONFIG.DIFFICULTY_LEVELS.HARD
        ? AI_CONFIG.MOVE_SELECTION.HARD_TOP_MOVES
        : effectiveDifficulty === AI_CONFIG.DIFFICULTY_LEVELS.MEDIUM
        ? AI_CONFIG.MOVE_SELECTION.MEDIUM_TOP_MOVES
        : AI_CONFIG.MOVE_SELECTION.EASY_TOP_MOVES
    );

    const chosenMove = possibleMoves[randomInt(topN)];

    const lookaheadStats = this.lookaheadEngine.getStats();
    AITelemetry.logDecision({
      engineVersion: AI_CONFIG.FEATURE_FLAGS.ENGINE_V2_ENABLED ? "v2" : "v1",
      difficulty: effectiveDifficulty,
      playerId: aiPlayerId,
      elapsedMs: Date.now() - startTime,
      totalCandidates: possibleMoves.length,
      evaluatedCandidates: Math.min(topN, possibleMoves.length),
      nodesEvaluated: lookaheadStats.nodesEvaluated,
      searchDepth: lookaheadStats.maxDepthReached,
      selectedMove: {
        user_card_instance_id: chosenMove.user_card_instance_id,
        position: chosenMove.position,
        score: chosenMove.score,
      },
      topCandidates: possibleMoves
        .slice(0, AI_CONFIG.TELEMETRY.LOG_TOP_CANDIDATES)
        .map((move) => ({
          user_card_instance_id: move.user_card_instance_id,
          position: move.position,
          score: move.score,
        })),
      notes: `opponent_archetype=${opponentArchetypeProfile.primary};confidence=${opponentArchetypeProfile.confidence.toFixed(2)}`,
    });

    return {
      action_type: "placeCard",
      user_card_instance_id: chosenMove.user_card_instance_id,
      position: chosenMove.position,
    };
  }
}
