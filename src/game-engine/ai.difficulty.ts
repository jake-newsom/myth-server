import { AI_CONFIG } from "../config/constants";

interface ResolveDifficultyParams {
  isTowerGame?: boolean;
  floorNumber?: number | null;
  isTimeoutFallback?: boolean;
}

export function resolveAIDifficulty({
  isTowerGame = false,
  floorNumber = null,
  isTimeoutFallback = false,
}: ResolveDifficultyParams): string {
  // Difficulty scaling has been intentionally removed:
  // always run the strongest AI profile.
  void isTowerGame;
  void floorNumber;
  void isTimeoutFallback;
  return AI_CONFIG.DIFFICULTY_LEVELS.HARD;
}
