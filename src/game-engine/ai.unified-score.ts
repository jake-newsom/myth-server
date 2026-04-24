import { AI_CONFIG } from "../config/constants";
import { InGameCard } from "../types/card.types";
import { BoardPosition, GameState } from "../types/game.types";
import { AbilityAnalyzer } from "./ai.ability-analyzer";
import { AbilityRuleEngine } from "./ai.rules.engine";
import { StrategicEvaluator } from "./ai.strategic-evaluator";

export interface UnifiedScoreBreakdown {
  immediate_flips: number;
  expected_future_flips: number;
  permanent_power_gain: number;
  denial_value: number;
  board_control: number;
  combo_value: number;
  risk: number;
  total: number;
}

function getAbilityId(card: InGameCard): string {
  return (
    card.base_card_data.special_ability?.id ??
    card.base_card_data.special_ability?.ability_id ??
    ""
  );
}

function getGamePhase(gameState: GameState): "early" | "mid" | "late" {
  const played = gameState.board.flat().filter((cell) => !!cell.card).length;
  if (played <= 4) return "early";
  if (played <= 10) return "mid";
  return "late";
}

export class UnifiedScoreV2 {
  constructor(
    private abilityAnalyzer: AbilityAnalyzer,
    private strategicEvaluator: StrategicEvaluator,
    private abilityRuleEngine: AbilityRuleEngine
  ) {}

  scoreMove(
    gameState: GameState,
    cardToPlay: InGameCard,
    position: BoardPosition,
    aiPlayerId: string
  ): UnifiedScoreBreakdown {
    const weights = AI_CONFIG.MOVE_EVALUATION.FORMULA_COMPONENT_WEIGHTS;
    const abilityId = getAbilityId(cardToPlay);
    const phase = getGamePhase(gameState);

    const immediateFlips = this.evaluateImmediateFlips(
      gameState,
      cardToPlay,
      position,
      aiPlayerId
    );
    const expectedFutureFlips = this.evaluateExpectedFutureFlips(
      gameState,
      cardToPlay,
      position,
      aiPlayerId,
      phase
    );
    const permanentPowerGain = this.evaluatePermanentPowerGain(
      abilityId,
      phase,
      gameState,
      cardToPlay,
      aiPlayerId
    );
    const denialValue = this.evaluateDenialValue(
      gameState,
      cardToPlay,
      position,
      aiPlayerId
    );
    const boardControl = this.evaluateBoardControl(
      gameState,
      cardToPlay,
      position,
      aiPlayerId
    );
    const comboValue = this.evaluateComboValue(
      gameState,
      cardToPlay,
      position,
      aiPlayerId
    );
    const risk = this.evaluateRisk(
      gameState,
      cardToPlay,
      position,
      aiPlayerId
    );

    const total =
      immediateFlips * weights.immediate_flips +
      expectedFutureFlips * weights.expected_future_flips +
      permanentPowerGain * weights.permanent_power_gain +
      denialValue * weights.denial_value +
      boardControl * weights.board_control +
      comboValue * weights.combo_value -
      risk * weights.risk;

    return {
      immediate_flips: immediateFlips,
      expected_future_flips: expectedFutureFlips,
      permanent_power_gain: permanentPowerGain,
      denial_value: denialValue,
      board_control: boardControl,
      combo_value: comboValue,
      risk,
      total,
    };
  }

  private evaluateImmediateFlips(
    gameState: GameState,
    card: InGameCard,
    position: BoardPosition,
    aiPlayerId: string
  ): number {
    let score = 0;
    const directions = [
      { dx: 0, dy: -1, from: "bottom", to: "top" },
      { dx: 1, dy: 0, from: "left", to: "right" },
      { dx: 0, dy: 1, from: "top", to: "bottom" },
      { dx: -1, dy: 0, from: "right", to: "left" },
    ] as const;

    for (const dir of directions) {
      const nx = position.x + dir.dx;
      const ny = position.y + dir.dy;
      const cell = gameState.board[ny]?.[nx];
      if (!cell?.card || cell.card.owner === aiPlayerId) continue;

      const placedPower = card.current_power[dir.from];
      const adjacentPower = cell.card.current_power[dir.to];
      if (placedPower > adjacentPower) {
        score += AI_CONFIG.MOVE_EVALUATION.FLIP_BONUS;
      }
    }

    return score;
  }

  private evaluateExpectedFutureFlips(
    gameState: GameState,
    card: InGameCard,
    position: BoardPosition,
    aiPlayerId: string,
    phase: "early" | "mid" | "late"
  ): number {
    const futurePotential = this.strategicEvaluator.evaluateFuturePotential(
      gameState,
      position,
      aiPlayerId
    );
    const recurringAbilityIds = new Set([
      "fenrir_devourer_surge",
      "futakuchi_onna_vengeful_bite",
      "tsukuyomi_moons_balance",
      "nightmarchers_dread_aura",
      "kanehekili_thunderous_omen",
      "lono_fertile_ground",
      "nurarihyon_slipstream",
      "mooinanea_sacred_spring",
    ]);

    const abilityId = getAbilityId(card);
    const recurringBonus = recurringAbilityIds.has(abilityId)
      ? phase === "early"
        ? 70
        : phase === "mid"
        ? 45
        : 20
      : 0;

    return futurePotential + recurringBonus;
  }

  private evaluatePermanentPowerGain(
    abilityId: string,
    phase: "early" | "mid" | "late",
    gameState: GameState,
    card: InGameCard,
    aiPlayerId: string
  ): number {
    const permanentGainAbilities = new Set([
      "odin_foresight",
      "tawara_piercing_shot",
      "poliahu_icy_presence",
      "vali_revenge",
      "urd_past_weaves",
      "ku_war_stance",
      "sigurd_slayer",
    ]);

    let score = permanentGainAbilities.has(abilityId) ? 60 : 0;
    if (abilityId === "fenrir_devourer_surge") score += 45;
    if (abilityId === "maui_sun_trick") score += 35;

    if (phase === "early") score *= 1.3;
    if (phase === "late") score *= 0.8;

    // Reuse hold-value understanding for scaling cards.
    const holdValue = this.abilityAnalyzer.evaluateHandHoldValue(
      gameState,
      card,
      aiPlayerId
    );
    if (holdValue > 80) {
      score -= 25;
    }

    return score;
  }

  private evaluateDenialValue(
    gameState: GameState,
    card: InGameCard,
    position: BoardPosition,
    aiPlayerId: string
  ): number {
    const ruleEval = this.abilityRuleEngine.evaluate({
      gameState,
      card,
      position,
      aiPlayerId,
    });

    const abilityImpact = this.abilityAnalyzer.evaluateAbilityImpact(
      gameState,
      card,
      position,
      aiPlayerId
    );

    // Rule penalties already include avoid conditions. Add the most denial-relevant
    // portion of ability impact rather than all impact.
    return ruleEval.preferScore + ruleEval.avoidScore + abilityImpact * 0.25;
  }

  private evaluateBoardControl(
    gameState: GameState,
    card: InGameCard,
    position: BoardPosition,
    aiPlayerId: string
  ): number {
    const strategic = this.strategicEvaluator.evaluateStrategicPosition(
      gameState,
      card,
      position,
      aiPlayerId
    );
    const blocking = this.strategicEvaluator.evaluateBlockingValue(
      gameState,
      position,
      aiPlayerId
    );
    return strategic + blocking;
  }

  private evaluateComboValue(
    gameState: GameState,
    card: InGameCard,
    position: BoardPosition,
    aiPlayerId: string
  ): number {
    const chainScore = this.abilityAnalyzer.evaluateAbilityChains(
      gameState,
      card,
      position,
      aiPlayerId
    );
    const ruleEval = this.abilityRuleEngine.evaluate({
      gameState,
      card,
      position,
      aiPlayerId,
    });
    return chainScore + ruleEval.placementScore + ruleEval.timingScore;
  }

  private evaluateRisk(
    gameState: GameState,
    card: InGameCard,
    position: BoardPosition,
    aiPlayerId: string
  ): number {
    const ruleEval = this.abilityRuleEngine.evaluate({
      gameState,
      card,
      position,
      aiPlayerId,
    });

    const adjacentEnemyPower = [
      gameState.board[position.y - 1]?.[position.x]?.card,
      gameState.board[position.y]?.[position.x + 1]?.card,
      gameState.board[position.y + 1]?.[position.x]?.card,
      gameState.board[position.y]?.[position.x - 1]?.card,
    ]
      .filter((item): item is InGameCard => !!item && item.owner !== aiPlayerId)
      .reduce((sum, enemy) => {
        return (
          sum +
          enemy.current_power.top +
          enemy.current_power.right +
          enemy.current_power.bottom +
          enemy.current_power.left
        );
      }, 0);

    const selfPower =
      card.current_power.top +
      card.current_power.right +
      card.current_power.bottom +
      card.current_power.left;

    const localExposurePenalty = Math.max(0, adjacentEnemyPower - selfPower * 1.2) * 0.2;
    return localExposurePenalty + ruleEval.riskPenalty;
  }
}
