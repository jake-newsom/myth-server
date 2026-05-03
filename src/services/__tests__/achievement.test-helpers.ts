import AchievementService from "../achievement.service";

export type IncrementCall = {
  userId: string;
  baseKey: string;
  incrementBy: number;
};

export function createResult() {
  return {
    newlyCompleted: [],
    updatedProgress: [],
  };
}

export function stubIncrementTracker() {
  const calls: IncrementCall[] = [];
  const original = AchievementService.incrementTieredCharacterAchievement;

  (AchievementService as any).incrementTieredCharacterAchievement = async (
    userId: string,
    baseKey: string,
    incrementBy: number
  ) => {
    calls.push({ userId, baseKey, incrementBy });
  };

  return {
    calls,
    restore() {
      (AchievementService as any).incrementTieredCharacterAchievement = original;
    },
  };
}
