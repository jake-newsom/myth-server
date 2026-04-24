import { InGameCard } from "../types/card.types";
import { BoardPosition, GameState } from "../types/game.types";

export type RuleTiming = "early" | "mid" | "late" | "conditional";
export type RuleRiskProfile =
  | "safe"
  | "swingy"
  | "combo"
  | "comeback"
  | "denial"
  | "anchor";
export type RuleOperator = ">" | ">=" | "<" | "<=" | "==" | "!=";

export interface RuleCondition {
  metric: string;
  operator: RuleOperator;
  value: number;
  score: number;
}

export interface PlacementRule {
  metric: string;
  score: number;
}

export interface AbilityRule {
  cardId: string;
  timing: RuleTiming;
  riskProfile: RuleRiskProfile;
  preferWhen: RuleCondition[];
  avoidWhen: RuleCondition[];
  placementPriorities: PlacementRule[];
}

export interface AbilityRuleEvaluationContext {
  gameState: GameState;
  card: InGameCard;
  position: BoardPosition;
  aiPlayerId: string;
}

export interface AbilityRuleEvaluation {
  ruleMatched: boolean;
  preferScore: number;
  avoidScore: number;
  placementScore: number;
  timingScore: number;
  riskPenalty: number;
  totalScore: number;
}
