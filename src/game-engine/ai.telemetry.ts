import { BoardPosition } from "../types/game.types";
import { AI_CONFIG } from "../config/constants";

export interface AIMoveCandidateSnapshot {
  user_card_instance_id: string;
  position: BoardPosition;
  score: number;
}

export interface AIDecisionTelemetry {
  engineVersion: "v1" | "v2";
  difficulty: string;
  playerId: string;
  elapsedMs: number;
  totalCandidates: number;
  evaluatedCandidates: number;
  nodesEvaluated: number;
  searchDepth: number;
  selectedMove?: AIMoveCandidateSnapshot;
  topCandidates: AIMoveCandidateSnapshot[];
  notes?: string;
}

export const AITelemetry = {
  shouldLog(): boolean {
    return AI_CONFIG.TELEMETRY.ENABLED;
  },

  logDecision(payload: AIDecisionTelemetry): void {
    if (!this.shouldLog()) return;
    console.log("[AI_TELEMETRY]", JSON.stringify(payload));
  },
};
