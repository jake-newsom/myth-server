import { ABILITY_RULES } from "./ai.rules.catalog";
import { buildAbilityRuleMetrics, MetricMap } from "./ai.rule-metrics";
import {
  AbilityRule,
  AbilityRuleEvaluation,
  AbilityRuleEvaluationContext,
  RuleCondition,
} from "./ai.rule-types";

function evaluateCondition(condition: RuleCondition, metrics: MetricMap): boolean {
  const actual = metrics[condition.metric] ?? 0;
  switch (condition.operator) {
    case ">":
      return actual > condition.value;
    case ">=":
      return actual >= condition.value;
    case "<":
      return actual < condition.value;
    case "<=":
      return actual <= condition.value;
    case "==":
      return actual === condition.value;
    case "!=":
      return actual !== condition.value;
    default:
      return false;
  }
}

function getTimingScore(rule: AbilityRule, metrics: MetricMap): number {
  const turnsRemaining = metrics.turnsRemaining ?? 0;
  if (rule.timing === "conditional") return 0;

  const phase = turnsRemaining >= 8 ? "early" : turnsRemaining >= 4 ? "mid" : "late";
  if (rule.timing === phase) return 15;
  return -8;
}

function getRiskPenalty(rule: AbilityRule, metrics: MetricMap): number {
  const safePlacementScore = metrics.safePlacementScore ?? 0;
  const playerRatio = metrics.playerOwnedOccupiedRatio ?? 0;
  const enemyRatio = metrics.enemyOwnedOccupiedRatio ?? 0;

  if (rule.riskProfile === "safe") {
    return safePlacementScore < 0 ? Math.abs(safePlacementScore) * 0.4 : 0;
  }

  if (rule.riskProfile === "swingy") {
    // High variance is good when behind, bad when ahead.
    if (playerRatio > enemyRatio) return 25;
    return 5;
  }

  if (rule.riskProfile === "comeback") {
    if (playerRatio > enemyRatio) return 20;
    return 0;
  }

  if (rule.riskProfile === "anchor") {
    return safePlacementScore < 0 ? 15 : 0;
  }

  return 0;
}

export class AbilityRuleEngine {
  evaluate(context: AbilityRuleEvaluationContext): AbilityRuleEvaluation {
    const abilityId =
      context.card.base_card_data.special_ability?.id ??
      context.card.base_card_data.special_ability?.ability_id ??
      "";

    if (!abilityId || !ABILITY_RULES[abilityId]) {
      return {
        ruleMatched: false,
        preferScore: 0,
        avoidScore: 0,
        placementScore: 0,
        timingScore: 0,
        riskPenalty: 0,
        totalScore: 0,
      };
    }

    const rule = ABILITY_RULES[abilityId];
    const metrics = buildAbilityRuleMetrics(
      context.gameState,
      context.card,
      context.position,
      context.aiPlayerId
    );

    const preferScore = rule.preferWhen.reduce((sum, condition) => {
      return evaluateCondition(condition, metrics) ? sum + condition.score : sum;
    }, 0);

    const avoidScore = rule.avoidWhen.reduce((sum, condition) => {
      return evaluateCondition(condition, metrics) ? sum + condition.score : sum;
    }, 0);

    const placementScore = rule.placementPriorities.reduce((sum, priority) => {
      const metricValue = metrics[priority.metric] ?? 0;
      return sum + metricValue * priority.score;
    }, 0);

    const timingScore = getTimingScore(rule, metrics);
    const riskPenalty = getRiskPenalty(rule, metrics);
    const totalScore = preferScore + avoidScore + placementScore + timingScore - riskPenalty;

    return {
      ruleMatched: true,
      preferScore,
      avoidScore,
      placementScore,
      timingScore,
      riskPenalty,
      totalScore,
    };
  }
}
