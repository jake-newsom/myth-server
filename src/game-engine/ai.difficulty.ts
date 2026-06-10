import { AI_CONFIG } from "../config/constants";

interface ResolveDifficultyParams {
  isTowerGame?: boolean;
  floorNumber?: number | null;
  isTimeoutFallback?: boolean;
  sagaAiProfile?: "basic" | "intermediate" | "advanced";
}

export function resolveAIDifficulty({
  isTowerGame = false,
  floorNumber = null,
  isTimeoutFallback = false,
  sagaAiProfile,
}: ResolveDifficultyParams): string {
  void isTowerGame;
  void floorNumber;
  void isTimeoutFallback;

  if (sagaAiProfile === "basic") {
    return AI_CONFIG.DIFFICULTY_LEVELS.MEDIUM ?? AI_CONFIG.DIFFICULTY_LEVELS.HARD;
  }
  if (sagaAiProfile === "intermediate" || sagaAiProfile === "advanced") {
    return AI_CONFIG.DIFFICULTY_LEVELS.HARD;
  }

  return AI_CONFIG.DIFFICULTY_LEVELS.HARD;
}
