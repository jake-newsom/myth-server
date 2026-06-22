import { GameState, BoardPosition } from "../types/game.types";
import { InGameCard } from "../types/card.types";
import { AI_CONFIG, GAME_CONFIG } from "../config/constants";
import * as _ from "lodash";
import * as validators from "./game.validators";
import { GameLogic } from "./game.logic";
import { simulationContext } from "./simulation.context";
import { StrategicEvaluator } from "./ai.strategic-evaluator";

export interface AILookaheadCandidate {
  user_card_instance_id: string;
  position: BoardPosition;
  score: number;
}

interface TranspositionEntry {
  value: number;
  depth: number;
}

export class LookaheadEngine {
  private static readonly SEARCH_CANDIDATE_CAP = 24;
  private static readonly ROOT_CANDIDATE_CAP = 20;
  private static readonly SEARCH_SCORE_WEIGHT = 0.85;
  private startTime = 0;
  private maxTimeMs: number = AI_CONFIG.LOOKAHEAD.MAX_TIME_MS;
  private nodesEvaluated = 0;
  private maxDepthReached = 0;
  private transpositionTable = new Map<string, TranspositionEntry>();
  private principalVariation = new Map<string, AILookaheadCandidate>();
  private strategicEvaluator = new StrategicEvaluator();

  // Leaf material weights (kept dominant — captures are what actually win).
  private static readonly LEAF_CARD_WEIGHT = 220;
  private static readonly LEAF_POWER_WEIGHT = 1.8;
  // Positional/ability term is scaled down so it shades between equal-material
  // states without overriding the material signal.
  private static readonly LEAF_POSITIONAL_WEIGHT = 0.5;

  private getDifficultyBudget(difficulty: string): number {
    const upper = difficulty.toUpperCase();
    if (upper === "EASY") return AI_CONFIG.LOOKAHEAD.BUDGET_MS.EASY;
    if (upper === "HARD") return AI_CONFIG.LOOKAHEAD.BUDGET_MS.HARD;
    return AI_CONFIG.LOOKAHEAD.BUDGET_MS.MEDIUM;
  }

  private getSampleCount(difficulty: string): number {
    const upper = difficulty.toUpperCase();
    if (upper === "EASY") return AI_CONFIG.LOOKAHEAD.STOCHASTIC_SAMPLES.EASY;
    if (upper === "HARD") return AI_CONFIG.LOOKAHEAD.STOCHASTIC_SAMPLES.HARD;
    return AI_CONFIG.LOOKAHEAD.STOCHASTIC_SAMPLES.MEDIUM;
  }

  private timedOut(): boolean {
    return Date.now() - this.startTime > this.maxTimeMs;
  }

  private getStateHash(gameState: GameState, playerId: string): string {
    // The hash must capture everything that distinguishes one position from
    // another, otherwise the transposition table returns a value computed for a
    // *different* state. The previous version encoded only each card's owner and
    // 4 power values, so positions that differed only in tile effects, temporary
    // buffs, or hand contents collided and reused stale search values.
    const boardToken = gameState.board
      .flat()
      .map((cell) => {
        const tileToken = this.tileEffectToken(cell.tile_effect);
        if (!cell.card) return `0${tileToken}`;
        const c = cell.card;
        const ownerTag = c.owner === playerId ? "A" : "E";
        const abilityId =
          c.base_card_data.special_ability?.id ??
          c.base_card_data.special_ability?.ability_id ??
          "";
        return `${ownerTag}${c.current_power.top},${c.current_power.right},${c.current_power.bottom},${c.current_power.left}#${abilityId}${this.tempEffectToken(c)}${tileToken}`;
      })
      .join("|");

    // Hand contents change which moves are reachable, so two boards that look
    // identical but have different hands are genuinely different positions.
    const handToken = `${this.handToken(gameState.player1)}/${this.handToken(gameState.player2)}`;

    return `${boardToken}::${handToken}::${gameState.current_player_id}::${gameState.turn_number}`;
  }

  private tileEffectToken(effect?: GameState["board"][number][number]["tile_effect"]): string {
    if (!effect) return "";
    const power = effect.power
      ? `${effect.power.top ?? 0},${effect.power.right ?? 0},${effect.power.bottom ?? 0},${effect.power.left ?? 0}`
      : "";
    return `~${effect.status}${effect.terrain ?? ""}${effect.turns_left ?? 0}${power}`;
  }

  private tempEffectToken(card: InGameCard): string {
    if (!card.temporary_effects || card.temporary_effects.length === 0) return "";
    // Sort so effect ordering doesn't produce different hashes for equal states.
    return (
      "+" +
      card.temporary_effects
        .map((e) => {
          const p = e.power ?? {};
          return `${p.top ?? 0},${p.right ?? 0},${p.bottom ?? 0},${p.left ?? 0}:${e.duration}`;
        })
        .sort()
        .join(",")
    );
  }

  private handToken(player: GameState["player1"]): string {
    // Hand identity matters, not order; sort for a stable signature.
    return [...player.hand].sort().join(",");
  }

  private evaluateBoardState(gameState: GameState, aiPlayerId: string): number {
    if (gameState.status !== "active") {
      return this.evaluateEndState(gameState, aiPlayerId);
    }

    let aiCards = 0;
    let enemyCards = 0;
    let aiPower = 0;
    let enemyPower = 0;
    let positional = 0;

    for (let y = 0; y < gameState.board.length; y++) {
      const row = gameState.board[y];
      for (let x = 0; x < row.length; x++) {
        const cell = row[x];
        if (!cell.card) continue;
        const card = cell.card;
        const cardPower =
          card.current_power.top +
          card.current_power.right +
          card.current_power.bottom +
          card.current_power.left;

        // Ability-aware positional term: how well the card sits for its owner.
        // Summing the real strategic evaluator over each side's placed cards
        // lets the search prefer leaves where the AI's ability cards are well
        // positioned and enemy threats are not — the previous material-only
        // leaf was ability-blind and disagreed with the 1-ply root evaluator.
        const placement = this.strategicEvaluator.evaluateStrategicPosition(
          gameState,
          card,
          { x, y },
          card.owner
        );

        if (card.owner === aiPlayerId) {
          aiCards++;
          aiPower += cardPower;
          positional += placement;
        } else {
          enemyCards++;
          enemyPower += cardPower;
          positional -= placement;
        }
      }
    }

    return (
      (aiCards - enemyCards) * LookaheadEngine.LEAF_CARD_WEIGHT +
      (aiPower - enemyPower) * LookaheadEngine.LEAF_POWER_WEIGHT +
      positional * LookaheadEngine.LEAF_POSITIONAL_WEIGHT
    );
  }

  private quickEvaluateMove(
    gameState: GameState,
    card: InGameCard,
    position: BoardPosition,
    playerId: string
  ): number {
    let score = 0;

    // Quick flip count
    const directions = [
      { dx: 0, dy: -1, from: "bottom", to: "top" },
      { dx: 1, dy: 0, from: "left", to: "right" },
      { dx: 0, dy: 1, from: "top", to: "bottom" },
      { dx: -1, dy: 0, from: "right", to: "left" },
    ];

    let flips = 0;
    for (const dir of directions) {
      const nx = position.x + dir.dx;
      const ny = position.y + dir.dy;

      if (
        nx >= 0 &&
        nx < GAME_CONFIG.BOARD_SIZE &&
        ny >= 0 &&
        ny < GAME_CONFIG.BOARD_SIZE
      ) {
        const cell = gameState.board[ny][nx];
        if (cell?.card && cell.card.owner !== playerId) {
          const placedPower = (card.current_power as any)[dir.from];
          const adjacentPower = (cell.card.current_power as any)[dir.to];
          if (placedPower > adjacentPower) {
            flips++;
          }
        }
      }
    }

    score += flips * 100;
    score +=
      card.current_power.top +
      card.current_power.right +
      card.current_power.bottom +
      card.current_power.left;

    // Encourage corner/edge pressure in ordering.
    const isCorner =
      (position.x === 0 || position.x === GAME_CONFIG.BOARD_SIZE - 1) &&
      (position.y === 0 || position.y === GAME_CONFIG.BOARD_SIZE - 1);
    const isEdge =
      position.x === 0 ||
      position.x === GAME_CONFIG.BOARD_SIZE - 1 ||
      position.y === 0 ||
      position.y === GAME_CONFIG.BOARD_SIZE - 1;
    if (isCorner) score += 20;
    else if (isEdge) score += 10;

    // Ability-aware ordering: surface placements that satisfy (or violate) a
    // card's ability position requirements so strong ability plays are searched
    // first, improving alpha-beta pruning. This is the cheapest slice of the
    // strategic evaluator, so move ordering stays inexpensive.
    score += this.strategicEvaluator.evaluateAbilityPositionRequirements(
      gameState,
      card,
      position,
      playerId
    );

    return score;
  }

  private getPlayer(state: GameState, playerId: string) {
    return state.player1.user_id === playerId ? state.player1 : state.player2;
  }

  private getOpponentId(state: GameState, playerId: string): string {
    return state.player1.user_id === playerId
      ? state.player2.user_id
      : state.player1.user_id;
  }

  private generateMoves(
    gameState: GameState,
    playerId: string
  ): AILookaheadCandidate[] {
    const player = this.getPlayer(gameState, playerId);
    const moves: AILookaheadCandidate[] = [];
    const maxCandidateCount = LookaheadEngine.SEARCH_CANDIDATE_CAP;

    for (const cardId of player.hand) {
      const cardData = gameState.hydrated_card_data_cache?.[cardId];
      if (!cardData) continue;
      if (cardData.owner !== playerId) continue;

      for (let y = 0; y < GAME_CONFIG.BOARD_SIZE; y++) {
        for (let x = 0; x < GAME_CONFIG.BOARD_SIZE; x++) {
          const position = { x, y };
          const canPlace = validators.canPlaceOnTile(gameState, position);
          if (!canPlace.canPlace) continue;

          moves.push({
            user_card_instance_id: cardId,
            position,
            score: this.quickEvaluateMove(gameState, cardData, position, playerId),
          });
        }
      }
    }

    moves.sort((a, b) => b.score - a.score);
    return moves.slice(0, maxCandidateCount);
  }

  private orderMoves(
    gameState: GameState,
    playerId: string,
    moves: AILookaheadCandidate[]
  ): AILookaheadCandidate[] {
    const key = `${this.getStateHash(gameState, playerId)}::pv`;
    const pv = this.principalVariation.get(key);
    if (!pv) return moves;

    return [...moves].sort((a, b) => {
      if (
        a.user_card_instance_id === pv.user_card_instance_id &&
        a.position.x === pv.position.x &&
        a.position.y === pv.position.y
      ) {
        return -1;
      }
      if (
        b.user_card_instance_id === pv.user_card_instance_id &&
        b.position.x === pv.position.x &&
        b.position.y === pv.position.y
      ) {
        return 1;
      }
      return b.score - a.score;
    });
  }

  private async simulateMoveWithSampling(
    gameState: GameState,
    move: AILookaheadCandidate,
    playerId: string,
    difficulty: string,
    evaluateFn: (state: GameState) => Promise<number>
  ): Promise<number> {
    const sampleCount = this.getSampleCount(difficulty);
    let total = 0;
    let completed = 0;

    for (let i = 0; i < sampleCount; i++) {
      if (this.timedOut()) break;
      const sampleSeed = this.seedFromMove(move, gameState.turn_number + i);
      const simulatedState = await this.simulateMove(
        gameState,
        move.user_card_instance_id,
        move.position,
        playerId,
        sampleSeed
      );
      if (!simulatedState) continue;
      total += await evaluateFn(simulatedState);
      completed++;
    }

    if (completed === 0) return -9999;
    return total / completed;
  }

  private seedFromMove(move: AILookaheadCandidate, salt: number): number {
    let seed = 2166136261;
    const seedInput = `${move.user_card_instance_id}:${move.position.x}:${move.position.y}:${salt}`;
    for (let i = 0; i < seedInput.length; i++) {
      seed ^= seedInput.charCodeAt(i);
      seed += (seed << 1) + (seed << 4) + (seed << 7) + (seed << 8) + (seed << 24);
    }
    return seed >>> 0;
  }

  private async simulateMove(
    gameState: GameState,
    cardInstanceId: string,
    position: BoardPosition,
    playerId: string,
    seed?: number
  ): Promise<GameState | null> {
    try {
      const clonedState = _.cloneDeep(gameState);

      // Use GameLogic to simulate the move within simulation context
      const result = await simulationContext.withSimulation(
        async () =>
          GameLogic.placeCard(clonedState, playerId, cardInstanceId, position),
        seed
      );

      return result.state;
    } catch (error) {
      // Invalid move
      return null;
    }
  }

  private evaluateEndState(gameState: GameState, aiPlayerId: string): number {
    if (gameState.winner === aiPlayerId) {
      return 10000; // Winning is highest value
    } else if (gameState.winner === null) {
      return 0; // Draw
    } else {
      return -10000; // Losing is worst
    }
  }

  startTiming(): void {
    this.startTime = Date.now();
    this.nodesEvaluated = 0;
    this.maxDepthReached = 0;
    this.transpositionTable.clear();
  }

  private isTacticallyVolatile(gameState: GameState, playerId: string): boolean {
    const moves = this.generateMoves(gameState, playerId).slice(0, 6);
    return moves.some((move) => move.score >= AI_CONFIG.MOVE_EVALUATION.FLIP_BONUS);
  }

  private async negamax(
    gameState: GameState,
    currentPlayerId: string,
    aiPlayerId: string,
    depth: number,
    alpha: number,
    beta: number,
    difficulty: string,
    inQuiescence = false
  ): Promise<number> {
    this.nodesEvaluated++;
    if (this.timedOut()) {
      return this.evaluateBoardState(gameState, aiPlayerId);
    }

    if (gameState.status !== "active") {
      return this.evaluateEndState(gameState, aiPlayerId);
    }

    // Endgame: when few tiles remain the full game tree is small enough to solve
    // exactly. Switch to deterministic minimax-to-the-end so the AI plays the
    // closing moves perfectly instead of trusting the heuristic leaf.
    if (
      this.countPlaceableTiles(
        gameState,
        AI_CONFIG.LOOKAHEAD.EXACT_ENDGAME_MAX_EMPTY
      ) <= AI_CONFIG.LOOKAHEAD.EXACT_ENDGAME_MAX_EMPTY
    ) {
      return this.exactEndgameSearch(
        gameState,
        currentPlayerId,
        aiPlayerId,
        alpha,
        beta
      );
    }

    const hash = `${this.getStateHash(gameState, currentPlayerId)}::${depth}`;
    const cached = this.transpositionTable.get(hash);
    if (cached && cached.depth >= depth) {
      return cached.value;
    }

    if (depth <= 0) {
      if (!inQuiescence && this.isTacticallyVolatile(gameState, currentPlayerId)) {
        return this.negamax(
          gameState,
          currentPlayerId,
          aiPlayerId,
          1,
          alpha,
          beta,
          difficulty,
          true
        );
      }
      return this.evaluateBoardState(gameState, aiPlayerId);
    }

    let bestValue = -Infinity;
    let orderedMoves = this.generateMoves(gameState, currentPlayerId);
    if (orderedMoves.length === 0) {
      return this.evaluateBoardState(gameState, aiPlayerId);
    }

    orderedMoves = this.orderMoves(gameState, currentPlayerId, orderedMoves);

    for (const move of orderedMoves) {
      if (this.timedOut()) break;
      const moveValue = await this.simulateMoveWithSampling(
        gameState,
        move,
        currentPlayerId,
        difficulty,
        async (nextState) => {
          const nextPlayerId = this.getOpponentId(nextState, currentPlayerId);
          return -(
            await this.negamax(
              nextState,
              nextPlayerId,
              aiPlayerId,
              depth - 1,
              -beta,
              -alpha,
              difficulty,
              inQuiescence
            )
          );
        }
      );
      bestValue = Math.max(bestValue, moveValue);
      alpha = Math.max(alpha, moveValue);
      if (alpha >= beta) {
        break;
      }
    }

    if (bestValue === -Infinity) {
      bestValue = this.evaluateBoardState(gameState, aiPlayerId);
    }
    this.transpositionTable.set(hash, { value: bestValue, depth });
    return bestValue;
  }

  /**
   * Counts placeable tiles, but stops early once the count exceeds `limit`.
   * The endgame gate only cares whether the count is at or below the threshold,
   * so midgame nodes (the common case) bail after limit+1 cheap checks instead
   * of scanning the whole board at every node.
   */
  private countPlaceableTiles(gameState: GameState, limit: number): number {
    let count = 0;
    for (let y = 0; y < GAME_CONFIG.BOARD_SIZE; y++) {
      for (let x = 0; x < GAME_CONFIG.BOARD_SIZE; x++) {
        if (validators.canPlaceOnTile(gameState, { x, y }).canPlace) {
          count++;
          if (count > limit) return count;
        }
      }
    }
    return count;
  }

  /**
   * Exact, deterministic negamax to the end of the game. Used only when few
   * placeable tiles remain (see EXACT_ENDGAME_MAX_EMPTY), where the tree is
   * small enough to solve fully. Unlike the heuristic search this never falls
   * back to evaluateBoardState mid-tree and never samples — each move is
   * simulated once, so the returned value is the true game-theoretic outcome
   * (win/draw/loss) under optimal play, modulo the timeout safety net.
   */
  private async exactEndgameSearch(
    gameState: GameState,
    currentPlayerId: string,
    aiPlayerId: string,
    alpha: number,
    beta: number
  ): Promise<number> {
    this.nodesEvaluated++;

    if (gameState.status !== "active") {
      return this.evaluateEndState(gameState, aiPlayerId);
    }

    // Safety net: if the "small" endgame is somehow still expensive (e.g. an
    // ability that branches widely), bail to the heuristic value rather than
    // blow the latency budget. Correctness of the overall move is preserved
    // because the caller still has the heuristic-scored candidates.
    if (this.timedOut()) {
      return this.evaluateBoardState(gameState, aiPlayerId);
    }

    const moves = this.generateMoves(gameState, currentPlayerId);
    if (moves.length === 0) {
      // No move for the side to act. Hand the turn to the opponent; if neither
      // can move the simulation will resolve the game on its own.
      const opponentId = this.getOpponentId(gameState, currentPlayerId);
      const opponentMoves = this.generateMoves(gameState, opponentId);
      if (opponentMoves.length === 0) {
        return this.evaluateEndState(gameState, aiPlayerId);
      }
      return -(await this.exactEndgameSearch(
        gameState,
        opponentId,
        aiPlayerId,
        -beta,
        -alpha
      ));
    }

    let bestValue = -Infinity;
    for (const move of moves) {
      if (this.timedOut()) break;
      // Deterministic single simulation — no stochastic sampling in exact mode.
      const nextState = await this.simulateMove(
        gameState,
        move.user_card_instance_id,
        move.position,
        currentPlayerId
      );
      if (!nextState) continue;
      const opponentId = this.getOpponentId(nextState, currentPlayerId);
      const value = -(await this.exactEndgameSearch(
        nextState,
        opponentId,
        aiPlayerId,
        -beta,
        -alpha
      ));
      bestValue = Math.max(bestValue, value);
      alpha = Math.max(alpha, value);
      if (alpha >= beta) break;
    }

    if (bestValue === -Infinity) {
      return this.evaluateBoardState(gameState, aiPlayerId);
    }
    return bestValue;
  }

  async reScoreCandidatesWithSearch(
    gameState: GameState,
    aiPlayerId: string,
    candidates: AILookaheadCandidate[],
    difficulty: string,
    maxDepth: number
  ): Promise<AILookaheadCandidate[]> {
    this.maxTimeMs = Math.min(
      this.getDifficultyBudget(difficulty),
      AI_CONFIG.LOOKAHEAD.MAX_TIME_MS
    );
    this.startTiming();
    if (maxDepth <= 0 || candidates.length === 0) return candidates;

    const workingCandidates = [...candidates];
    workingCandidates.sort((a, b) => b.score - a.score);
    const rootCandidates = workingCandidates.slice(
      0,
      Math.min(LookaheadEngine.ROOT_CANDIDATE_CAP, workingCandidates.length)
    );

    const bestByDepth = new Map<string, number>();

    for (let depth = 1; depth <= maxDepth; depth++) {
      if (this.timedOut()) break;
      this.maxDepthReached = Math.max(this.maxDepthReached, depth);
      let alpha = -Infinity;
      let beta = Infinity;

      const orderedRoots = [...rootCandidates].sort((a, b) => {
        const aKey = `${a.user_card_instance_id}:${a.position.x}:${a.position.y}`;
        const bKey = `${b.user_card_instance_id}:${b.position.x}:${b.position.y}`;
        return (bestByDepth.get(bKey) ?? b.score) - (bestByDepth.get(aKey) ?? a.score);
      });

      for (const rootMove of orderedRoots) {
        if (this.timedOut()) break;
        const rootScore = await this.simulateMoveWithSampling(
          gameState,
          rootMove,
          aiPlayerId,
          difficulty,
          async (nextState) => {
            const opponentId = this.getOpponentId(nextState, aiPlayerId);
            return -(
              await this.negamax(
                nextState,
                opponentId,
                aiPlayerId,
                depth - 1,
                -beta,
                -alpha,
                difficulty
              )
            );
          }
        );
        const key = `${rootMove.user_card_instance_id}:${rootMove.position.x}:${rootMove.position.y}`;
        const blendedScore =
          rootScore * LookaheadEngine.SEARCH_SCORE_WEIGHT +
          rootMove.score * (1 - LookaheadEngine.SEARCH_SCORE_WEIGHT);
        bestByDepth.set(key, blendedScore);
        alpha = Math.max(alpha, rootScore);
      }
    }

    for (const move of workingCandidates) {
      const key = `${move.user_card_instance_id}:${move.position.x}:${move.position.y}`;
      if (bestByDepth.has(key)) {
        move.score = bestByDepth.get(key) ?? move.score;
      }
    }

    return workingCandidates;
  }

  async evaluateWithLookahead(
    gameState: GameState,
    cardInstanceId: string,
    position: BoardPosition,
    aiPlayerId: string,
    depth: number,
    baseScore: number
  ): Promise<number> {
    const [scored] = await this.reScoreCandidatesWithSearch(
      gameState,
      aiPlayerId,
      [{ user_card_instance_id: cardInstanceId, position, score: baseScore }],
      "medium",
      depth
    );
    return scored?.score ?? baseScore;
  }

  getStats(): { nodesEvaluated: number; timeMs: number; maxDepthReached: number } {
    return {
      nodesEvaluated: this.nodesEvaluated,
      timeMs: Date.now() - this.startTime,
      maxDepthReached: this.maxDepthReached,
    };
  }
}
