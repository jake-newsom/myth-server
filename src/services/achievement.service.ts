import AchievementModel, {
  AchievementAdminInput,
  AchievementAdminUpdate,
} from "../models/achievement.model";
import UserModel from "../models/user.model";
import BorderModel from "../models/border.model";
import CharacterModel from "../models/character.model";
import RewardService from "./reward.service";
import { achievementRewardsToItems } from "../utils/rewards.helpers";
import {
  Achievement,
  UserAchievementWithDetails,
} from "../types/database.types";
import { GrantedReward } from "../types/service.types";
import { RarityUtils } from "../types/card.types";

interface AchievementProgressEvent {
  userId: string;
  eventType: string;
  eventData?: any;
}

interface AchievementCompletionResult {
  newlyCompleted: UserAchievementWithDetails[];
  updatedProgress: UserAchievementWithDetails[];
  autoClaimedRewards?: ClaimRewardsResult;
}

interface BatchedAchievementUpdate {
  achievement_key: string;
  mode: "increment" | "set";
  value: number;
}

interface ClaimRewardsResult {
  success: boolean;
  claimedAchievements: UserAchievementWithDetails[];
  totalRewards: {
    gems: number;
    fate_coins: number;
    packs: number;
    card_fragments: number;
    borders: number;
  };
  grantedItems?: GrantedReward[];
  updatedCurrencies?: {
    gems: number;
    fate_coins: number;
    pack_count: number;
    card_fragments: number;
    total_xp: number;
  };
}

interface AdminAchievementUpsertResult {
  success: boolean;
  achievement?: Achievement;
  error?: string;
}

const AI_SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

const ACHIEVEMENT_DEBUG_ENABLED = process.env.NODE_ENV !== "production";

function debugAchievementProgress(
  message: string,
  payload: Record<string, unknown>
): void {
  if (!ACHIEVEMENT_DEBUG_ENABLED) return;
  // Temporary debug visibility for validating character milestone tracking.
  console.log(`[ACHIEVEMENT_DEBUG] ${message}`, payload);
}

const CHARACTER_ACHIEVEMENT_BASE_KEYS = {
  fenrir: "char_fenrir_ach",
  loki: "char_loki_ach",
  surtr: "char_surtr_ach",
  susanoo: "char_susanoo_ach",
  kamohoalii: "char_kamohoalii_ach",
  thor: "char_thor_ach",
  skadi: "char_skadi_ach",
  kupua: "char_kupua_ach",
  kanehekili: "char_kanehekili_ach",
  amaterasu: "char_amaterasu_ach",
  jorogumo: "char_jorogumo_ach",
  pele: "char_pele_ach",
  sigurd: "char_sigurd_ach",
  yukionna: "char_yukionna_ach",
  futakuchionna: "char_futakuchionna_ach",
  yamabiko: "char_yamabiko_ach",
  benkei: "char_benkei_ach",
  minamoto: "char_minamoto_ach",
  kintaro: "char_kintaro_ach",
  yamatanoorochi: "char_yamatanoorochi_ach",
  ryujin: "char_ryujin_ach",
  tsukuyomi: "char_tsukuyomi_ach",
  hachiman: "char_hachiman_ach",
  nurarihyon: "char_nurarihyon_ach",
  maui: "char_maui_ach",
  ku: "char_ku_ach",
  milu: "char_milu_ach",
  ukupa: "char_ukupa_ach",
  nightmarchers: "char_nightmarchers_ach",
  kamapuaa: "char_kamapuaa_ach",
  kaahupahau: "char_kaahupahau_ach",
  baldr: "char_baldr_ach",
  hel: "char_hel_ach",
  kane: "char_kane_ach",
  laamaomao: "char_laamaomao_ach",
  jormungandr: "char_jormungandr_ach",
  vidar: "char_vidar_ach",
} as const;

const DESTROY_ABILITY_TO_BASE_KEY: Record<string, string> = {
  fenrir_devourer_surge: CHARACTER_ACHIEVEMENT_BASE_KEYS.fenrir,
  surtr_flames: CHARACTER_ACHIEVEMENT_BASE_KEYS.surtr,
};

const FLIP_ABILITY_TO_BASE_KEY: Record<string, string> = {
};

const DEBUFF_BATCH_THRESHOLDS: Record<string, number> = {
  thor_push: 5,
  skadi_freeze: 3,
  yuki_onna_frost_row: 3,
  futakuchi_onna_vengeful_bite: 4,
  yamata_many_heads: 5,
};

const DEBUFF_BATCH_TO_BASE_KEY: Record<string, string> = {
  thor_push: CHARACTER_ACHIEVEMENT_BASE_KEYS.thor,
  skadi_freeze: CHARACTER_ACHIEVEMENT_BASE_KEYS.skadi,
  yuki_onna_frost_row: CHARACTER_ACHIEVEMENT_BASE_KEYS.yukionna,
  futakuchi_onna_vengeful_bite: CHARACTER_ACHIEVEMENT_BASE_KEYS.futakuchionna,
  yamata_many_heads: CHARACTER_ACHIEVEMENT_BASE_KEYS.yamatanoorochi,
};

const DEBUFF_BATCH_EVENT_THRESHOLDS: Record<string, number> = {
  kupua_dual_aspect: 4,
};

const DEBUFF_BATCH_EVENT_TO_BASE_KEY: Record<string, string> = {
  kupua_dual_aspect: CHARACTER_ACHIEVEMENT_BASE_KEYS.kupua,
};

const BUFF_BATCH_THRESHOLDS: Record<string, number> = {
  hachiman_warriors_aura: 3,
};

const BUFF_BATCH_TO_BASE_KEY: Record<string, string> = {
  hachiman_warriors_aura: CHARACTER_ACHIEVEMENT_BASE_KEYS.hachiman,
};

const KU_BLOOD_ALTAR_ABILITY_IDS = new Set([
  "ku_war_stance",
  "ku_blood_altar",
  "blood_altar",
]);

const ACCUMULATED_BUFF_THRESHOLDS: Record<
  string,
  { threshold: number; baseKey: string }
> = {
  sigurd_slayer: {
    threshold: 10,
    baseKey: CHARACTER_ACHIEVEMENT_BASE_KEYS.sigurd,
  },
};

const debuffBatchTargetTracker = new Map<string, Set<string>>();
const debuffBatchEventCounts = new Map<string, number>();
const debuffBatchAwarded = new Set<string>();
const buffBatchTargetTracker = new Map<string, Set<string>>();
const buffBatchAwarded = new Set<string>();
const matchEnemyDebuffCounts = new Map<string, Map<string, number>>();
const matchEnemyDebuffAwarded = new Map<string, Set<string>>();
const amaterasuTurnBlessingCounts = new Map<string, Map<number, number>>();
const peleLavaFieldPowerByCard = new Map<string, Map<string, number>>();
const ryujinFlipBatchTargets = new Map<string, Set<string>>();
const ryujinFlipBatchAwarded = new Set<string>();
const lokiFlipBatchTargets = new Map<string, Set<string>>();
const lokiFlipBatchAwarded = new Set<string>();
const yamabikoCopiedTargets = new Map<string, Map<string, Set<string>>>();
const helTurnCaptureCounts = new Map<string, Map<number, number>>();
const helTurnAwarded = new Map<string, Set<number>>();
const kaneTurnProtectedTargets = new Map<string, Map<number, Set<string>>>();
const kaneTurnAwarded = new Map<string, Set<number>>();
const abilityBuffAccumulators = new Map<string, number>();
const nightmarchersCursedTileCounts = new Map<string, number>();
const nightmarchersAwardedThisMatch = new Set<string>();
const ukupaCardWaterTileCounts = new Map<string, Map<string, number>>();
const ukupaCardAwardedThisMatch = new Map<string, Set<string>>();
const kamapuaaAboveThreshold = new Map<string, boolean>();
const kuBloodAltarDefeatedTargets = new Map<string, Map<string, Set<string>>>();
const kuBloodAltarAwardedCards = new Map<string, Set<string>>();
const kuBloodAltarFlipTargets = new Map<string, Set<string>>();
const kuBloodAltarFlipAwarded = new Set<string>();

const AchievementService = {
  /**
   * Get all achievements for a user with their progress
   */
  async getUserAchievements(
    userId: string,
    category?: string,
    completedOnly: boolean = false,
    unclaimedOnly: boolean = false,
    includeLocked: boolean = false
  ): Promise<{
    success: boolean;
    achievements: UserAchievementWithDetails[];
    stats: any;
  }> {
    try {
      const [achievements, stats] = await Promise.all([
        AchievementModel.getAllUserAchievements(
          userId,
          category,
          includeLocked
        ),
        AchievementModel.getUserAchievementStats(userId),
      ]);

      // Filter based on parameters
      let filteredAchievements = achievements;

      if (completedOnly) {
        filteredAchievements = filteredAchievements.filter(
          (a) => a.is_completed
        );
      }

      if (unclaimedOnly) {
        filteredAchievements = filteredAchievements.filter((a) => a.can_claim);
      }

      return {
        success: true,
        achievements: filteredAchievements,
        stats,
      };
    } catch (error) {
      console.error("Error fetching user achievements:", error);
      return {
        success: false,
        achievements: [],
        stats: {
          total_achievements: 0,
          completed_achievements: 0,
          claimed_achievements: 0,
          completion_percentage: 0,
          total_rewards_earned: {
            gems: 0,
            fate_coins: 0,
            packs: 0,
            card_fragments: 0,
          },
          achievements_by_category: {},
          achievements_by_rarity: {},
        },
      };
    }
  },

  /**
   * Get character-scoped achievements for a user.
   */
  async getCharacterAchievementsForUser(
    userId: string,
    characterId: string,
    includeLocked: boolean = false
  ): Promise<{
    success: boolean;
    achievements: UserAchievementWithDetails[];
  }> {
    try {
      const achievements = await AchievementModel.getCharacterAchievementsForUser(
        userId,
        characterId,
        includeLocked
      );

      return {
        success: true,
        achievements,
      };
    } catch (error) {
      console.error("Error fetching character achievements:", error);
      return {
        success: false,
        achievements: [],
      };
    }
  },

  async createAdminAchievement(
    input: AchievementAdminInput
  ): Promise<AdminAchievementUpsertResult> {
    try {
      const validationError = await this.validateAdminAchievementInput({
        achievement_kind: input.achievement_kind ?? "standard",
        character_id: input.character_id ?? null,
        reward_border_id: input.reward_border_id ?? null,
      });
      if (validationError) {
        return { success: false, error: validationError };
      }

      const achievement = await AchievementModel.createAchievement(input);
      return { success: true, achievement };
    } catch (error) {
      console.error("Error creating admin achievement:", error);
      return { success: false, error: "Failed to create achievement" };
    }
  },

  async updateAdminAchievement(
    achievementId: string,
    updates: AchievementAdminUpdate
  ): Promise<AdminAchievementUpsertResult> {
    try {
      const existing = await AchievementModel.getAchievementById(achievementId);
      if (!existing) {
        return { success: false, error: "Achievement not found" };
      }

      const merged = {
        achievement_kind: updates.achievement_kind ?? existing.achievement_kind,
        character_id:
          updates.character_id !== undefined
            ? updates.character_id
            : (existing.character_id ?? null),
        reward_border_id:
          updates.reward_border_id !== undefined
            ? updates.reward_border_id
            : (existing.reward_border_id ?? null),
      };

      const validationError = await this.validateAdminAchievementInput(merged);
      if (validationError) {
        return { success: false, error: validationError };
      }

      const achievement = await AchievementModel.updateAchievement(
        achievementId,
        updates
      );
      if (!achievement) {
        return { success: false, error: "Achievement not found" };
      }
      return { success: true, achievement };
    } catch (error) {
      console.error("Error updating admin achievement:", error);
      return { success: false, error: "Failed to update achievement" };
    }
  },

  async deactivateAdminAchievement(
    achievementId: string
  ): Promise<AdminAchievementUpsertResult> {
    try {
      const achievement = await AchievementModel.softDeleteAchievement(
        achievementId
      );
      if (!achievement) {
        return { success: false, error: "Achievement not found" };
      }
      return { success: true, achievement };
    } catch (error) {
      console.error("Error deactivating admin achievement:", error);
      return { success: false, error: "Failed to deactivate achievement" };
    }
  },

  async validateAdminAchievementInput(input: {
    achievement_kind?: "standard" | "character";
    character_id?: string | null;
    reward_border_id?: string | null;
  }): Promise<string | null> {
    const achievementKind = input.achievement_kind ?? "standard";
    const characterId = input.character_id ?? null;
    const rewardBorderId = input.reward_border_id ?? null;

    if (achievementKind === "character") {
      if (!characterId) {
        return "character_id is required for character achievements";
      }

      const character = await CharacterModel.findById(characterId);
      if (!character) {
        return "character_id does not reference an existing character";
      }
    } else if (characterId) {
      return "character_id must be null for standard achievements";
    }

    if (rewardBorderId) {
      const border = await BorderModel.findById(rewardBorderId);
      if (!border || !border.is_active) {
        return "reward_border_id does not reference an active border";
      }

      if (achievementKind === "character") {
        if (!border.character_id || border.character_id !== characterId) {
          return "reward border must be locked to the same character_id";
        }
      }
    }

    return null;
  },

  /**
   * Get achievement categories with counts
   */
  async getAchievementCategories(): Promise<{
    success: boolean;
    categories: Array<{
      category: string;
      total_count: number;
      display_name: string;
    }>;
  }> {
    try {
      const allAchievements = await AchievementModel.getAllAchievements(false);

      const categoryMap = new Map();
      const displayNames: Record<string, string> = {
        gameplay: "Gameplay",
        collection: "Collection",
        social: "Social",
        progression: "Progression",
        special: "Special",
      };

      allAchievements.forEach((achievement) => {
        const count = categoryMap.get(achievement.category) || 0;
        categoryMap.set(achievement.category, count + 1);
      });

      const categories = Array.from(categoryMap.entries()).map(
        ([category, count]) => ({
          category,
          total_count: count,
          display_name: displayNames[category] || category,
        })
      );

      return {
        success: true,
        categories,
      };
    } catch (error) {
      console.error("Error fetching achievement categories:", error);
      return {
        success: false,
        categories: [],
      };
    }
  },

  /**
   * Process achievement progress based on game events
   */
  async processAchievementProgress(
    event: AchievementProgressEvent
  ): Promise<AchievementCompletionResult> {
    const result: AchievementCompletionResult = {
      newlyCompleted: [],
      updatedProgress: [],
    };

    try {
      switch (event.eventType) {
        case "game_victory":
          await this.handleGameVictory(event.userId, event.eventData, result);
          break;
        case "game_completion":
          await this.handleGameCompletion(
            event.userId,
            event.eventData,
            result
          );
          break;
        case "pack_opened":
          await this.handlePackOpened(event.userId, event.eventData, result);
          break;
        case "card_collected":
          await this.handleCardCollected(event.userId, event.eventData, result);
          break;
        case "card_leveled":
          await this.handleCardLeveled(event.userId, event.eventData, result);
          break;
        case "xp_transfer":
          await this.handleXpTransfer(event.userId, event.eventData, result);
          break;
        case "card_sacrifice":
          await this.handleCardSacrifice(event.userId, event.eventData, result);
          break;
        case "friend_added":
          await this.handleFriendAdded(event.userId, event.eventData, result);
          break;
        case "friend_challenge":
          await this.handleFriendChallenge(
            event.userId,
            event.eventData,
            result
          );
          break;
        case "user_registration":
          await this.handleUserRegistration(
            event.userId,
            event.eventData,
            result
          );
          break;
        case "card_destroyed":
          await this.handleCardDestroyed(event.userId, event.eventData, result);
          break;
        case "card_flipped":
          await this.handleCardFlipped(event.userId, event.eventData, result);
          break;
        case "power_debuff_applied":
          await this.handlePowerDebuffApplied(
            event.userId,
            event.eventData,
            result
          );
          break;
        case "power_buff_applied":
          await this.handlePowerBuffApplied(event.userId, event.eventData, result);
          break;
        case "tile_state_changed":
          await this.handleTileStateChanged(event.userId, event.eventData, result);
          break;
        default:
          console.log(`Unknown achievement event type: ${event.eventType}`);
      }
    } catch (error) {
      console.error(
        `Error processing achievement event ${event.eventType}:`,
        error
      );
    }

    // Check for tier unlocks after processing all achievements
    for (const completed of result.newlyCompleted) {
      const unlockedTiers = await this.checkAndUnlockNextTier(
        event.userId,
        completed.achievement.achievement_key
      );
      // Add newly unlocked tiers to updatedProgress so they appear in the response
      result.updatedProgress.push(...unlockedTiers);
    }

    // Auto-claim character achievements so the user gets rewards immediately
    const characterCompletions = result.newlyCompleted.filter(
      (a) => a.achievement.achievement_kind === "character"
    );

    if (characterCompletions.length > 0) {
      const achievementIds = characterCompletions.map((a) => a.achievement_id);
      try {
        const claimResult = await this.claimAchievementRewards(
          event.userId,
          achievementIds
        );
        if (claimResult.success) {
          result.autoClaimedRewards = claimResult;
          for (const completed of characterCompletions) {
            completed.is_claimed = true;
            completed.can_claim = false;
          }
        }
      } catch (error) {
        console.error(
          "Error auto-claiming character achievement rewards:",
          error
        );
      }
    }

    return result;
  },

  async applyBatchedUpdatesAndCollectDetails(
    userId: string,
    updates: BatchedAchievementUpdate[],
    keysToFetch: string[],
    result: AchievementCompletionResult
  ): Promise<void> {
    if (updates.length > 0) {
      await AchievementModel.applyProgressUpdatesBatch(userId, updates);
    }

    if (keysToFetch.length === 0) {
      return;
    }

    const uniqueKeys = Array.from(new Set(keysToFetch));
    const achievementDetailsMap = await AchievementModel.getUserAchievementsByKeys(
      userId,
      uniqueKeys
    );

    achievementDetailsMap.forEach((details) => {
      if (details.is_completed) {
        result.newlyCompleted.push(details);
      } else {
        result.updatedProgress.push(details);
      }
    });
  },

  async incrementTieredCharacterAchievement(
    userId: string,
    baseKey: string,
    incrementBy: number,
    result: AchievementCompletionResult
  ): Promise<void> {
    const tiers = await AchievementModel.getTieredAchievementsByBaseKey(baseKey);
    if (tiers.length === 0) return;

    debugAchievementProgress("increment-tiered-achievement", {
      userId,
      baseKey,
      incrementBy,
      tierKeys: tiers.map((t) => t.achievement_key),
    });

    const updates: BatchedAchievementUpdate[] = tiers.map((tier) => ({
      achievement_key: tier.achievement_key,
      mode: "increment",
      value: incrementBy,
    }));
    const keysToFetch = tiers.map((tier) => tier.achievement_key);

    await this.applyBatchedUpdatesAndCollectDetails(
      userId,
      updates,
      keysToFetch,
      result
    );
  },

  resetMatchScopedCounters(userId: string): void {
    debuffBatchTargetTracker.forEach((_value, key) => {
      if (key.startsWith(`${userId}:`)) debuffBatchTargetTracker.delete(key);
    });
    debuffBatchEventCounts.forEach((_value, key) => {
      if (key.startsWith(`${userId}:`)) debuffBatchEventCounts.delete(key);
    });
    debuffBatchAwarded.forEach((key) => {
      if (key.startsWith(`${userId}:`)) debuffBatchAwarded.delete(key);
    });
    buffBatchTargetTracker.forEach((_value, key) => {
      if (key.startsWith(`${userId}:`)) buffBatchTargetTracker.delete(key);
    });
    buffBatchAwarded.forEach((key) => {
      if (key.startsWith(`${userId}:`)) buffBatchAwarded.delete(key);
    });
    matchEnemyDebuffCounts.delete(userId);
    matchEnemyDebuffAwarded.delete(userId);
    amaterasuTurnBlessingCounts.delete(userId);
    peleLavaFieldPowerByCard.delete(userId);
    for (const key of Array.from(ryujinFlipBatchTargets.keys())) {
      if (key.startsWith(`${userId}:`)) {
        ryujinFlipBatchTargets.delete(key);
      }
    }
    for (const key of Array.from(ryujinFlipBatchAwarded)) {
      if (key.startsWith(`${userId}:`)) {
        ryujinFlipBatchAwarded.delete(key);
      }
    }
    lokiFlipBatchTargets.forEach((_value, key) => {
      if (key.startsWith(`${userId}:`)) lokiFlipBatchTargets.delete(key);
    });
    lokiFlipBatchAwarded.forEach((key) => {
      if (key.startsWith(`${userId}:`)) lokiFlipBatchAwarded.delete(key);
    });
    yamabikoCopiedTargets.delete(userId);
    helTurnCaptureCounts.delete(userId);
    helTurnAwarded.delete(userId);
    kaneTurnProtectedTargets.delete(userId);
    kaneTurnAwarded.delete(userId);
    abilityBuffAccumulators.forEach((_value, key) => {
      if (key.startsWith(`${userId}:`)) abilityBuffAccumulators.delete(key);
    });
    kamapuaaAboveThreshold.delete(userId);
    nightmarchersCursedTileCounts.delete(userId);
    nightmarchersAwardedThisMatch.delete(userId);
    ukupaCardWaterTileCounts.delete(userId);
    ukupaCardAwardedThisMatch.delete(userId);
    kuBloodAltarDefeatedTargets.delete(userId);
    kuBloodAltarAwardedCards.delete(userId);
    kuBloodAltarFlipTargets.forEach((_value, key) => {
      if (key.startsWith(`${userId}:`)) kuBloodAltarFlipTargets.delete(key);
    });
    kuBloodAltarFlipAwarded.forEach((key) => {
      if (key.startsWith(`${userId}:`)) kuBloodAltarFlipAwarded.delete(key);
    });
  },

  /**
   * Handle game victory events
   * Optimized to batch tier lookups for better performance
   */
  async handleGameVictory(
    userId: string,
    eventData: any,
    result: AchievementCompletionResult
  ): Promise<void> {
    const { gameMode, isWinStreak, winStreakCount, winnerScore, loserScore } =
      eventData;

    const keysToFetch: string[] = [];
    const updates: BatchedAchievementUpdate[] = [];

    // Determine which tiered achievements we need to look up
    const tieredKeysToFetch: string[] = [];
    if (gameMode === "solo") {
      tieredKeysToFetch.push("solo_wins");
    } else if (gameMode === "pvp") {
      tieredKeysToFetch.push("pvp_wins");
      if (isWinStreak && winStreakCount) {
        tieredKeysToFetch.push("pvp_win_streak");
      }
    }

    // Batch fetch all tiered achievements in a single query
    const tieredAchievements =
      await AchievementModel.getTieredAchievementsByBaseKeys(tieredKeysToFetch);

    // First Victory
    updates.push({
      achievement_key: "first_victory",
      mode: "increment",
      value: 1,
    });
    keysToFetch.push("first_victory");

    // Game mode specific victories - tiered achievements
    if (gameMode === "solo") {
      // Track solo_wins tiered achievements
      const soloWinsTiers = tieredAchievements.get("solo_wins") || [];
      for (const tier of soloWinsTiers) {
        updates.push({
          achievement_key: tier.achievement_key,
          mode: "increment",
          value: 1,
        });
        keysToFetch.push(tier.achievement_key);
      }

      // Keep legacy solo_master for backward compatibility
      updates.push({
        achievement_key: "solo_master",
        mode: "increment",
        value: 1,
      });
      keysToFetch.push("solo_master");
    } else if (gameMode === "pvp") {
      // Track pvp_wins tiered achievements
      const pvpWinsTiers = tieredAchievements.get("pvp_wins") || [];
      for (const tier of pvpWinsTiers) {
        updates.push({
          achievement_key: tier.achievement_key,
          mode: "increment",
          value: 1,
        });
        keysToFetch.push(tier.achievement_key);
      }

      // Track pvp_win_streak tiered achievements
      if (isWinStreak && winStreakCount) {
        const streakTiers = tieredAchievements.get("pvp_win_streak") || [];
        for (const tier of streakTiers) {
          if (winStreakCount >= tier.target_value) {
            updates.push({
              achievement_key: tier.achievement_key,
              mode: "set",
              value: 1,
            });
            keysToFetch.push(tier.achievement_key);
          }
        }
      }

      // Keep legacy pvp_warrior for backward compatibility
      updates.push({
        achievement_key: "pvp_warrior",
        mode: "increment",
        value: 1,
      });
      keysToFetch.push("pvp_warrior");

      // Keep legacy win_streak_5 for backward compatibility
      if (isWinStreak && winStreakCount >= 5) {
        updates.push({
          achievement_key: "win_streak_5",
          mode: "set",
          value: 1,
        });
        keysToFetch.push("win_streak_5");
      }
    }

    // Perfect game (won 16-0, meaning opponent has no cards on the board)
    if (winnerScore === 16 && loserScore === 0) {
      updates.push({
        achievement_key: "perfect_game",
        mode: "increment",
        value: 1,
      });
      keysToFetch.push("perfect_game");
    }

    // Score-based achievements (win by margin)
    if (winnerScore !== undefined && loserScore !== undefined) {
      const scoreMargin = winnerScore - loserScore;

      // Dominant victory (win by 10+ points)
      if (scoreMargin >= 10) {
        updates.push({
          achievement_key: "dominant_victory",
          mode: "increment",
          value: 1,
        });
        keysToFetch.push("dominant_victory");
      }

      // Close victory (win by 1-2 points)
      if (scoreMargin >= 1 && scoreMargin <= 2) {
        updates.push({
          achievement_key: "close_victory",
          mode: "increment",
          value: 1,
        });
        keysToFetch.push("close_victory");
      }
    }

    // Beta tester (play games during beta)
    updates.push({
      achievement_key: "beta_tester",
      mode: "increment",
      value: 1,
    });
    keysToFetch.push("beta_tester");

    await this.applyBatchedUpdatesAndCollectDetails(
      userId,
      updates,
      keysToFetch,
      result
    );
  },

  /**
   * Handle game completion events (including losses)
   * Optimized to batch tier lookups for better performance
   */
  async handleGameCompletion(
    userId: string,
    eventData: any,
    result: AchievementCompletionResult
  ): Promise<void> {
    this.resetMatchScopedCounters(userId);

    const keysToFetch: string[] = [];
    const updates: BatchedAchievementUpdate[] = [];

    // Batch fetch all tiered achievements in a single query
    const tieredAchievements =
      await AchievementModel.getTieredAchievementsByBaseKeys(["total_matches"]);

    // Track total_matches tiered achievements (solo + multiplayer combined)
    const totalMatchesTiers = tieredAchievements.get("total_matches") || [];
    for (const tier of totalMatchesTiers) {
      updates.push({
        achievement_key: tier.achievement_key,
        mode: "increment",
        value: 1,
      });
      keysToFetch.push(tier.achievement_key);
    }

    // Beta tester achievement for any game completion
    updates.push({
      achievement_key: "beta_tester",
      mode: "increment",
      value: 1,
    });
    keysToFetch.push("beta_tester");

    await this.applyBatchedUpdatesAndCollectDetails(
      userId,
      updates,
      keysToFetch,
      result
    );
  },

  /**
   * Handle pack opening events
   */
  async handlePackOpened(
    userId: string,
    eventData: any,
    result: AchievementCompletionResult
  ): Promise<void> {
    const { packsOpened = 1 } = eventData;
    const keysToFetch: string[] = [];
    const updates: BatchedAchievementUpdate[] = [];

    // Track pack_opening tiered achievements - INCREMENT by number of packs opened
    const packOpeningTiers =
      await AchievementModel.getTieredAchievementsByBaseKey("pack_opening");
    for (const tier of packOpeningTiers) {
      updates.push({
        achievement_key: tier.achievement_key,
        mode: "increment",
        value: packsOpened,
      });
      keysToFetch.push(tier.achievement_key);
    }

    // First pack (legacy) - INCREMENT by number of packs opened
    updates.push({
      achievement_key: "first_pack",
      mode: "increment",
      value: packsOpened,
    });
    keysToFetch.push("first_pack");

    // Pack addict (legacy) - INCREMENT by number of packs opened
    updates.push({
      achievement_key: "pack_addict",
      mode: "increment",
      value: packsOpened,
    });
    keysToFetch.push("pack_addict");

    await this.applyBatchedUpdatesAndCollectDetails(
      userId,
      updates,
      keysToFetch,
      result
    );
  },

  /**
   * Handle card collection events
   */
  async handleCardCollected(
    userId: string,
    eventData: any,
    result: AchievementCompletionResult
  ): Promise<void> {
    const { rarityCounts, totalUniqueCards, totalMythicCards } = eventData;
    const keysToFetch: string[] = [];
    const updates: BatchedAchievementUpdate[] = [];

    // Track card_collection tiered achievements (SET - only needs to be called once)
    if (totalUniqueCards !== undefined) {
      const cardCollectionTiers =
        await AchievementModel.getTieredAchievementsByBaseKey(
          "card_collection"
        );
      for (const tier of cardCollectionTiers) {
        updates.push({
          achievement_key: tier.achievement_key,
          mode: "set",
          value: totalUniqueCards,
        });
        keysToFetch.push(tier.achievement_key);
      }
    }

    // Track mythic_collection tiered achievements (SET - only needs to be called once)
    if (totalMythicCards !== undefined) {
      const mythicCollectionTiers =
        await AchievementModel.getTieredAchievementsByBaseKey(
          "mythic_collection"
        );
      for (const tier of mythicCollectionTiers) {
        updates.push({
          achievement_key: tier.achievement_key,
          mode: "set",
          value: totalMythicCards,
        });
        keysToFetch.push(tier.achievement_key);
      }
    }

    // Process rarity-specific achievements from rarityCounts
    if (rarityCounts) {
      // Rare collector (legacy) - INCREMENT by count
      const rareCount = rarityCounts.rare || 0;
      if (rareCount > 0) {
        updates.push({
          achievement_key: "rare_collector",
          mode: "increment",
          value: rareCount,
        });
        keysToFetch.push("rare_collector");
      }

      // Legendary hunter (legacy) - INCREMENT by count
      const legendaryCount = rarityCounts.legendary || 0;
      if (legendaryCount > 0) {
        updates.push({
          achievement_key: "legendary_hunter",
          mode: "increment",
          value: legendaryCount,
        });
        keysToFetch.push("legendary_hunter");
      }
    }

    // Card master (legacy) - SET
    if (totalUniqueCards) {
      updates.push({
        achievement_key: "card_master",
        mode: "set",
        value: totalUniqueCards,
      });
      keysToFetch.push("card_master");
    }

    await this.applyBatchedUpdatesAndCollectDetails(
      userId,
      updates,
      keysToFetch,
      result
    );
  },

  /**
   * Handle card leveling events
   */
  async handleCardLeveled(
    userId: string,
    eventData: any,
    result: AchievementCompletionResult
  ): Promise<void> {
    const { newLevel, isFirstLevelUp, cardsAtLevelByRarity } = eventData;
    const keysToFetch: string[] = [];
    const updates: BatchedAchievementUpdate[] = [];

    // Track card leveling by rarity achievements
    if (cardsAtLevelByRarity) {
      for (const [rarity, levels] of Object.entries(cardsAtLevelByRarity)) {
        const baseKey = `level_${rarity}`;
        const tiers = await AchievementModel.getTieredAchievementsByBaseKey(
          baseKey
        );

        for (const tier of tiers) {
          // tier.target_value contains the level requirement (2, 3, 4, 5)
          // Ensure target_value is a number
          const targetLevel =
            typeof tier.target_value === "string"
              ? parseInt(tier.target_value)
              : tier.target_value;
          const countAtLevel =
            (levels as Record<number, number>)[targetLevel] || 0;

          if (countAtLevel >= 20) {
            updates.push({
              achievement_key: tier.achievement_key,
              mode: "set",
              value: 1,
            });
            keysToFetch.push(tier.achievement_key);
          }
        }
      }
    }

    // Level up (first time leveling any card) - legacy
    if (isFirstLevelUp) {
      updates.push({
        achievement_key: "level_up",
        mode: "increment",
        value: 1,
      });
      keysToFetch.push("level_up");
    }

    // Max level (level 10) - legacy
    if (newLevel >= 10) {
      updates.push({
        achievement_key: "max_level",
        mode: "increment",
        value: 1,
      });
      keysToFetch.push("max_level");
    }

    await this.applyBatchedUpdatesAndCollectDetails(
      userId,
      updates,
      keysToFetch,
      result
    );
  },

  /**
   * Handle XP transfer events
   */
  async handleXpTransfer(
    userId: string,
    eventData: any,
    result: AchievementCompletionResult
  ): Promise<void> {
    await this.applyBatchedUpdatesAndCollectDetails(
      userId,
      [{ achievement_key: "xp_master", mode: "increment", value: 1 }],
      ["xp_master"],
      result
    );
  },

  /**
   * Handle card sacrifice events
   */
  async handleCardSacrifice(
    userId: string,
    eventData: any,
    result: AchievementCompletionResult
  ): Promise<void> {
    const { cardCount, totalSacrificed } = eventData;
    const keysToFetch: string[] = [];
    const updates: BatchedAchievementUpdate[] = [];

    // Track card_sacrifice tiered achievements
    const sacrificeTiers =
      await AchievementModel.getTieredAchievementsByBaseKey("card_sacrifice");

    if (totalSacrificed !== undefined) {
      for (const tier of sacrificeTiers) {
        updates.push({
          achievement_key: tier.achievement_key,
          mode: "set",
          value: totalSacrificed,
        });
        keysToFetch.push(tier.achievement_key);
      }
    } else {
      // Fallback to increment if totalSacrificed not provided
      for (const tier of sacrificeTiers) {
        updates.push({
          achievement_key: tier.achievement_key,
          mode: "increment",
          value: cardCount || 1,
        });
        keysToFetch.push(tier.achievement_key);
      }
    }

    // Sacrifice Master (legacy)
    updates.push({
      achievement_key: "sacrifice_master",
      mode: "increment",
      value: cardCount || 1,
    });
    keysToFetch.push("sacrifice_master");

    await this.applyBatchedUpdatesAndCollectDetails(
      userId,
      updates,
      keysToFetch,
      result
    );
  },

  /**
   * Handle friend addition events
   */
  async handleFriendAdded(
    userId: string,
    eventData: any,
    result: AchievementCompletionResult
  ): Promise<void> {
    const { totalFriends, isFirstFriend } = eventData;
    const keysToFetch: string[] = [];
    const updates: BatchedAchievementUpdate[] = [];

    // Social butterfly (first friend)
    if (isFirstFriend) {
      updates.push({
        achievement_key: "social_butterfly",
        mode: "increment",
        value: 1,
      });
      keysToFetch.push("social_butterfly");
    }

    // Friend collector (total friends)
    if (totalFriends) {
      updates.push({
        achievement_key: "friend_collector",
        mode: "set",
        value: totalFriends,
      });
      keysToFetch.push("friend_collector");
    }

    await this.applyBatchedUpdatesAndCollectDetails(
      userId,
      updates,
      keysToFetch,
      result
    );
  },

  /**
   * Handle friend challenge events
   */
  async handleFriendChallenge(
    userId: string,
    eventData: any,
    result: AchievementCompletionResult
  ): Promise<void> {
    await this.applyBatchedUpdatesAndCollectDetails(
      userId,
      [{ achievement_key: "challenger", mode: "increment", value: 1 }],
      ["challenger"],
      result
    );
  },

  /**
   * Handle user registration events
   */
  async handleUserRegistration(
    userId: string,
    eventData: any,
    result: AchievementCompletionResult
  ): Promise<void> {
    await this.applyBatchedUpdatesAndCollectDetails(
      userId,
      [{ achievement_key: "early_adopter", mode: "increment", value: 1 }],
      ["early_adopter"],
      result
    );
  },

  /**
   * Handle card destruction events sourced from gameplay utility hooks.
   */
  async handleCardDestroyed(
    userId: string,
    eventData: any,
    result: AchievementCompletionResult
  ): Promise<void> {
    const destroyerAbilityId = eventData?.destroyer_ability_id as
      | string
      | undefined;
    const destroyerOriginalOwner = eventData?.destroyer_original_owner as
      | string
      | undefined;
    const destroyerCardId = eventData?.destroyer_card_id as string | undefined;
    const targetCardId = eventData?.target_card_id as string | undefined;

    if (!destroyerAbilityId) {
      return;
    }

    // We already route this event to the acting user in the emitter. Keep the
    // original-owner guard only when that value is explicitly present.
    if (destroyerOriginalOwner && destroyerOriginalOwner !== userId) {
      return;
    }

    const directBaseKey = DESTROY_ABILITY_TO_BASE_KEY[destroyerAbilityId];
    if (directBaseKey) {
      await this.incrementTieredCharacterAchievement(
        userId,
        directBaseKey,
        1,
        result
      );
    }

    if (
      KU_BLOOD_ALTAR_ABILITY_IDS.has(destroyerAbilityId) &&
      destroyerCardId &&
      targetCardId
    ) {
      const perUserDefeats =
        kuBloodAltarDefeatedTargets.get(userId) || new Map<string, Set<string>>();
      const defeatedTargets =
        perUserDefeats.get(destroyerCardId) || new Set<string>();
      defeatedTargets.add(targetCardId);
      perUserDefeats.set(destroyerCardId, defeatedTargets);
      kuBloodAltarDefeatedTargets.set(userId, perUserDefeats);

      const awardedCards = kuBloodAltarAwardedCards.get(userId) || new Set<string>();
      if (defeatedTargets.size >= 2 && !awardedCards.has(destroyerCardId)) {
        awardedCards.add(destroyerCardId);
        kuBloodAltarAwardedCards.set(userId, awardedCards);
        await this.incrementTieredCharacterAchievement(
          userId,
          CHARACTER_ACHIEVEMENT_BASE_KEYS.ku,
          1,
          result
        );
      }
    }

    // Susanoo milestone tracks destroyed BEAST/DRAGON cards.
    if (destroyerAbilityId === "susanoo_storm_breaker") {
      const tags = ((eventData?.target_tags as string[] | undefined) || []).map(
        (tag) => tag.toUpperCase()
      );
      if (tags.some((tag) => tag === "BEAST" || tag === "DRAGON")) {
        await this.incrementTieredCharacterAchievement(
          userId,
          CHARACTER_ACHIEVEMENT_BASE_KEYS.susanoo,
          1,
          result
        );
      }
    }

    // Kamohoali'i milestone tracks defeating stronger enemies.
    if (
      destroyerAbilityId === "kamohoalii_oceans_shield" &&
      eventData?.defeated_stronger_enemy === true
    ) {
      await this.incrementTieredCharacterAchievement(
        userId,
        CHARACTER_ACHIEVEMENT_BASE_KEYS.kamohoalii,
        1,
        result
      );
    }
  },

  async handleCardFlipped(
    userId: string,
    eventData: any,
    result: AchievementCompletionResult
  ): Promise<void> {
    const sourceAbilityId = eventData?.source_ability_id as string | undefined;
    const sourceOriginalOwner = eventData?.source_original_owner as
      | string
      | undefined;
    const turnNumber = eventData?.turn_number as number | undefined;
    const sourceCardId = eventData?.source_card_id as string | undefined;
    const batchId = eventData?.batch_id as string | undefined;
    const targetCardName = eventData?.target_card_name as string | undefined;
    const targetCardId = eventData?.target_card_id as string | undefined;
    const sourceTotalPowerBefore = Number(
      eventData?.source_total_power_before || 0
    );
    const targetTotalPowerBefore = Number(
      eventData?.target_total_power_before || 0
    );

    if (!sourceAbilityId || sourceOriginalOwner !== userId) {
      return;
    }

    const baseKey = FLIP_ABILITY_TO_BASE_KEY[sourceAbilityId];
    if (baseKey) {
      await this.incrementTieredCharacterAchievement(userId, baseKey, 1, result);
    }

    if (sourceAbilityId === "loki_flip" && batchId) {
      const batchKey = `${userId}:${sourceCardId || "unknown"}:${batchId}`;
      const targets = lokiFlipBatchTargets.get(batchKey) || new Set<string>();
      if (targetCardName) targets.add(targetCardName);
      lokiFlipBatchTargets.set(batchKey, targets);

      debugAchievementProgress("loki-batch-progress", {
        userId,
        batchId,
        sourceCardId,
        uniqueFlips: targets.size,
        threshold: 3,
      });

      if (!lokiFlipBatchAwarded.has(batchKey) && targets.size >= 3) {
        lokiFlipBatchAwarded.add(batchKey);
        debugAchievementProgress("loki-batch-threshold-met", {
          userId,
          batchId,
          sourceCardId,
          uniqueFlips: targets.size,
        });
        await this.incrementTieredCharacterAchievement(
          userId,
          CHARACTER_ACHIEVEMENT_BASE_KEYS.loki,
          1,
          result
        );
      }
    }

    if (sourceCardId && targetCardId) {
      const perUser = yamabikoCopiedTargets.get(userId);
      const copiedTargetsForCard = perUser?.get(sourceCardId);
      if (copiedTargetsForCard?.has(targetCardId)) {
        copiedTargetsForCard.delete(targetCardId);
        debugAchievementProgress("yamabiko-copied-target-defeated", {
          userId,
          sourceCardId,
          targetCardId,
        });
        await this.incrementTieredCharacterAchievement(
          userId,
          CHARACTER_ACHIEVEMENT_BASE_KEYS.yamabiko,
          1,
          result
        );
      }
    }

    if (
      KU_BLOOD_ALTAR_ABILITY_IDS.has(sourceAbilityId) &&
      sourceCardId &&
      targetCardId
    ) {
      const batchKey = `${userId}:${sourceCardId}:${batchId || "none"}:${turnNumber ?? "n/a"}`;
      const flippedTargets = kuBloodAltarFlipTargets.get(batchKey) || new Set<string>();
      flippedTargets.add(targetCardId);
      kuBloodAltarFlipTargets.set(batchKey, flippedTargets);

      if (!kuBloodAltarFlipAwarded.has(batchKey) && flippedTargets.size >= 2) {
        kuBloodAltarFlipAwarded.add(batchKey);
        await this.incrementTieredCharacterAchievement(
          userId,
          CHARACTER_ACHIEVEMENT_BASE_KEYS.ku,
          1,
          result
        );
      }
    }

    if (
      sourceAbilityId === "kamohoalii_oceans_shield" &&
      targetTotalPowerBefore > sourceTotalPowerBefore
    ) {
      await this.incrementTieredCharacterAchievement(
        userId,
        CHARACTER_ACHIEVEMENT_BASE_KEYS.kamohoalii,
        1,
        result
      );
    }

    if (sourceAbilityId === "ryujin_tidal_sweep" && batchId && targetCardId) {
      const batchKey = `${userId}:${sourceCardId || "unknown"}:${batchId}`;
      const flippedTargets = ryujinFlipBatchTargets.get(batchKey) || new Set<string>();
      flippedTargets.add(targetCardId);
      ryujinFlipBatchTargets.set(batchKey, flippedTargets);
      debugAchievementProgress("ryujin-batch-progress", {
        userId,
        batchId,
        sourceCardId,
        uniqueFlips: flippedTargets.size,
        threshold: 2,
      });

      if (flippedTargets.size >= 2 && !ryujinFlipBatchAwarded.has(batchKey)) {
        ryujinFlipBatchAwarded.add(batchKey);
        debugAchievementProgress("ryujin-batch-threshold-met", {
          userId,
          batchId,
          sourceCardId,
          uniqueFlips: flippedTargets.size,
        });
        await this.incrementTieredCharacterAchievement(
          userId,
          CHARACTER_ACHIEVEMENT_BASE_KEYS.ryujin,
          1,
          result
        );
      }
    }
  },

  async handlePowerDebuffApplied(
    userId: string,
    eventData: any,
    result: AchievementCompletionResult
  ): Promise<void> {
    const sourceAbilityId = eventData?.source_ability_id as string | undefined;
    const targetCardId = eventData?.target_card_id as string | undefined;
    const batchId = eventData?.batch_id as string | undefined;
    const sourceCardId = eventData?.source_card_id as string | undefined;
    const turnNumber = eventData?.turn_number as number | undefined;
    const powerDelta = Number(eventData?.power_delta || 0);
    const targetTotalPowerBefore = Number(
      eventData?.target_total_power_before || 0
    );
    const targetMaxSidePowerBefore = Number(
      eventData?.target_max_side_power_before || 0
    );
    if (!sourceAbilityId || !targetCardId) {
      return;
    }

    const threshold = DEBUFF_BATCH_THRESHOLDS[sourceAbilityId];
    const baseKey = DEBUFF_BATCH_TO_BASE_KEY[sourceAbilityId];
    if (threshold && baseKey) {
      const batchKey = `${userId}:${sourceAbilityId}:${sourceCardId || "unknown"}:${batchId || "none"}:${turnNumber ?? "n/a"}`;
      const targets = debuffBatchTargetTracker.get(batchKey) || new Set<string>();
      targets.add(targetCardId);
      debuffBatchTargetTracker.set(batchKey, targets);

      if (!debuffBatchAwarded.has(batchKey) && targets.size >= threshold) {
        debuffBatchAwarded.add(batchKey);
        await this.incrementTieredCharacterAchievement(userId, baseKey, 1, result);
      }
    }

    const eventThreshold = DEBUFF_BATCH_EVENT_THRESHOLDS[sourceAbilityId];
    const eventBaseKey = DEBUFF_BATCH_EVENT_TO_BASE_KEY[sourceAbilityId];
    if (eventThreshold && eventBaseKey) {
      const batchKey = `${userId}:${sourceAbilityId}:${sourceCardId || "unknown"}:${batchId || "none"}:${turnNumber ?? "n/a"}`;
      const nextCount = (debuffBatchEventCounts.get(batchKey) || 0) + 1;
      debuffBatchEventCounts.set(batchKey, nextCount);

      if (!debuffBatchAwarded.has(batchKey) && nextCount >= eventThreshold) {
        debuffBatchAwarded.add(batchKey);
        await this.incrementTieredCharacterAchievement(
          userId,
          eventBaseKey,
          1,
          result
        );
      }
    }

    if (sourceAbilityId === "kanehekili_thunderous_omen") {
      const perUserCounts =
        matchEnemyDebuffCounts.get(userId) || new Map<string, number>();
      const awardedTargets =
        matchEnemyDebuffAwarded.get(userId) || new Set<string>();

      const nextCount = (perUserCounts.get(targetCardId) || 0) + 1;
      perUserCounts.set(targetCardId, nextCount);
      debugAchievementProgress("kanehekili-target-progress", {
        userId,
        targetCardId,
        count: nextCount,
        threshold: 3,
      });

      if (nextCount >= 3 && !awardedTargets.has(targetCardId)) {
        awardedTargets.add(targetCardId);
        debugAchievementProgress("kanehekili-threshold-met", {
          userId,
          targetCardId,
          count: nextCount,
        });
        await this.incrementTieredCharacterAchievement(
          userId,
          CHARACTER_ACHIEVEMENT_BASE_KEYS.kanehekili,
          1,
          result
        );
      }

      matchEnemyDebuffCounts.set(userId, perUserCounts);
      matchEnemyDebuffAwarded.set(userId, awardedTargets);
    }

    if (
      sourceAbilityId === "tsukuyomi_moons_balance" &&
      targetMaxSidePowerBefore >= 15
    ) {
      await this.incrementTieredCharacterAchievement(
        userId,
        CHARACTER_ACHIEVEMENT_BASE_KEYS.tsukuyomi,
        1,
        result
      );
    }

    if (
      sourceAbilityId === "milu_spirit_bind" &&
      targetMaxSidePowerBefore >= 12
    ) {
      await this.incrementTieredCharacterAchievement(
        userId,
        CHARACTER_ACHIEVEMENT_BASE_KEYS.milu,
        1,
        result
      );
    }

    // createOrUpdateDebuff bootstraps with a zero-value addTempDebuff event;
    // only count the real debuff application.
    if (sourceAbilityId === "kaahupahau_harbor_guardian" && powerDelta < 0) {
      await this.incrementTieredCharacterAchievement(
        userId,
        CHARACTER_ACHIEVEMENT_BASE_KEYS.kaahupahau,
        1,
        result
      );
    }

    if (sourceAbilityId === "jorogumo_web_curse") {
      await this.incrementTieredCharacterAchievement(
        userId,
        CHARACTER_ACHIEVEMENT_BASE_KEYS.jorogumo,
        1,
        result
      );
    }
  },

  async handlePowerBuffApplied(
    userId: string,
    eventData: any,
    result: AchievementCompletionResult
  ): Promise<void> {
    const sourceAbilityId = eventData?.source_ability_id as string | undefined;
    const turnNumber = eventData?.turn_number as number | undefined;
    const powerDelta = Number(eventData?.power_delta || 0);
    const batchId = eventData?.batch_id as string | undefined;
    const sourceCardId = eventData?.source_card_id as string | undefined;
    const targetCardId = eventData?.target_card_id as string | undefined;
    const copiedTargetCardId = eventData?.copied_target_card_id as
      | string
      | undefined;
    if (!sourceAbilityId) {
      return;
    }

    const batchThreshold = BUFF_BATCH_THRESHOLDS[sourceAbilityId];
    const batchBaseKey = BUFF_BATCH_TO_BASE_KEY[sourceAbilityId];
    if (batchThreshold && batchBaseKey && targetCardId) {
      const batchKey = `${userId}:${sourceAbilityId}:${sourceCardId || "unknown"}:${batchId || "none"}:${turnNumber ?? "n/a"}`;
      const targets = buffBatchTargetTracker.get(batchKey) || new Set<string>();
      targets.add(targetCardId);
      buffBatchTargetTracker.set(batchKey, targets);

      if (!buffBatchAwarded.has(batchKey) && targets.size >= batchThreshold) {
        buffBatchAwarded.add(batchKey);
        await this.incrementTieredCharacterAchievement(
          userId,
          batchBaseKey,
          1,
          result
        );
      }
    }

    if (sourceAbilityId === "amaterasu_radiant_blessing" && turnNumber) {
      const perTurn = amaterasuTurnBlessingCounts.get(userId) || new Map();
      const nextCount = (perTurn.get(turnNumber) || 0) + 1;
      perTurn.set(turnNumber, nextCount);
      amaterasuTurnBlessingCounts.set(userId, perTurn);

      if (nextCount === 3) {
        await this.incrementTieredCharacterAchievement(
          userId,
          CHARACTER_ACHIEVEMENT_BASE_KEYS.amaterasu,
          1,
          result
        );
      }
    }

    if (
      sourceAbilityId === "kane_pure_waters" &&
      turnNumber &&
      targetCardId &&
      eventData?.defeat_prevented_by_protection === true
    ) {
      const perTurn = kaneTurnProtectedTargets.get(userId) || new Map();
      const protectedTargets = perTurn.get(turnNumber) || new Set<string>();
      protectedTargets.add(targetCardId);
      perTurn.set(turnNumber, protectedTargets);
      kaneTurnProtectedTargets.set(userId, perTurn);

      const awardedTurns = kaneTurnAwarded.get(userId) || new Set<number>();
      kaneTurnAwarded.set(userId, awardedTurns);

      debugAchievementProgress("kane-protection-progress", {
        userId,
        turnNumber,
        protectedCount: protectedTargets.size,
        threshold: 2,
      });

      if (protectedTargets.size >= 2 && !awardedTurns.has(turnNumber)) {
        awardedTurns.add(turnNumber);
        debugAchievementProgress("kane-protection-threshold-met", {
          userId,
          turnNumber,
          protectedCount: protectedTargets.size,
        });
        await this.incrementTieredCharacterAchievement(
          userId,
          CHARACTER_ACHIEVEMENT_BASE_KEYS.kane,
          1,
          result
        );
      }
    }

    if (sourceAbilityId === "pele_lava_field" && powerDelta > 0 && sourceCardId) {
      const perUserCardPower =
        peleLavaFieldPowerByCard.get(userId) || new Map<string, number>();
      const previous = perUserCardPower.get(sourceCardId) || 0;
      const next = previous + powerDelta;
      perUserCardPower.set(sourceCardId, next);
      peleLavaFieldPowerByCard.set(userId, perUserCardPower);

      // Count exactly when a given Pele card reaches 5 stacks for the first time.
      if (previous < 5 && next >= 5) {
        await this.incrementTieredCharacterAchievement(
          userId,
          CHARACTER_ACHIEVEMENT_BASE_KEYS.pele,
          1,
          result
        );
      }
    }

    if (sourceAbilityId === "nurarihyon_slipstream") {
      await this.incrementTieredCharacterAchievement(
        userId,
        CHARACTER_ACHIEVEMENT_BASE_KEYS.nurarihyon,
        1,
        result
      );
    }

    if (sourceAbilityId === "benkei_steadfast_guard" && powerDelta >= 4) {
      await this.incrementTieredCharacterAchievement(
        userId,
        CHARACTER_ACHIEVEMENT_BASE_KEYS.benkei,
        1,
        result
      );
    }

    if (sourceAbilityId === "kintaro_beast_friend" && powerDelta >= 6) {
      await this.incrementTieredCharacterAchievement(
        userId,
        CHARACTER_ACHIEVEMENT_BASE_KEYS.kintaro,
        1,
        result
      );
    }

    if (sourceCardId && copiedTargetCardId) {
      const perUser = yamabikoCopiedTargets.get(userId) || new Map();
      const copiedTargetsForCard = perUser.get(sourceCardId) || new Set<string>();
      copiedTargetsForCard.add(copiedTargetCardId);
      perUser.set(sourceCardId, copiedTargetsForCard);
      yamabikoCopiedTargets.set(userId, perUser);
      debugAchievementProgress("yamabiko-copied-target-registered", {
        userId,
        sourceAbilityId,
        sourceCardId,
        copiedTargetCardId,
      });
    }

    if (sourceAbilityId === "minamoto_played_with_demon_bane_10") {
      await this.incrementTieredCharacterAchievement(
        userId,
        CHARACTER_ACHIEVEMENT_BASE_KEYS.minamoto,
        1,
        result
      );
    }

    if (sourceAbilityId === "maui_played_with_sun_trick_5") {
      await this.incrementTieredCharacterAchievement(
        userId,
        CHARACTER_ACHIEVEMENT_BASE_KEYS.maui,
        1,
        result
      );
    }

    if (sourceAbilityId === "baldr_immune") {
      await this.incrementTieredCharacterAchievement(
        userId,
        CHARACTER_ACHIEVEMENT_BASE_KEYS.baldr,
        1,
        result
      );
    }

    if (sourceAbilityId === "jormungandr_shell") {
      await this.incrementTieredCharacterAchievement(
        userId,
        CHARACTER_ACHIEVEMENT_BASE_KEYS.jormungandr,
        1,
        result
      );
    }

    if (sourceAbilityId === "vidar_vengeance") {
      await this.incrementTieredCharacterAchievement(
        userId,
        CHARACTER_ACHIEVEMENT_BASE_KEYS.vidar,
        1,
        result
      );
    }

    if (sourceAbilityId === "laamaomao_gale_aura" && powerDelta >= 2) {
      await this.incrementTieredCharacterAchievement(
        userId,
        CHARACTER_ACHIEVEMENT_BASE_KEYS.laamaomao,
        1,
        result
      );
    }

    if (sourceAbilityId === "hel_soul" && turnNumber) {
      const perTurn = helTurnCaptureCounts.get(userId) || new Map<number, number>();
      const awardedTurns = helTurnAwarded.get(userId) || new Set<number>();
      const nextCount = (perTurn.get(turnNumber) || 0) + 1;
      perTurn.set(turnNumber, nextCount);
      helTurnCaptureCounts.set(userId, perTurn);
      helTurnAwarded.set(userId, awardedTurns);

      if (nextCount >= 3 && !awardedTurns.has(turnNumber)) {
        awardedTurns.add(turnNumber);
        await this.incrementTieredCharacterAchievement(
          userId,
          CHARACTER_ACHIEVEMENT_BASE_KEYS.hel,
          1,
          result
        );
      }
    }

    const accumulatedThreshold = ACCUMULATED_BUFF_THRESHOLDS[sourceAbilityId];
    if (accumulatedThreshold && powerDelta > 0) {
      const accumulatorKey = `${userId}:${sourceAbilityId}:${sourceCardId || "unknown"}`;
      const current = abilityBuffAccumulators.get(accumulatorKey) || 0;
      const next = current + powerDelta;
      const increments = Math.floor(next / accumulatedThreshold.threshold);
      abilityBuffAccumulators.set(
        accumulatorKey,
        next % accumulatedThreshold.threshold
      );

      if (increments > 0) {
        await this.incrementTieredCharacterAchievement(
          userId,
          accumulatedThreshold.baseKey,
          increments,
          result
        );
      }
    }
  },

  async handleTileStateChanged(
    userId: string,
    eventData: any,
    result: AchievementCompletionResult
  ): Promise<void> {
    const status = eventData?.status as string | undefined;
    const animationLabel = eventData?.animation_label as string | undefined;
    const terrain = eventData?.terrain as string | undefined;
    const sourceAbilityId = eventData?.source_ability_id as string | undefined;
    const sourceCardId = eventData?.source_card_id as string | undefined;
    const lavaActiveCount = Number(eventData?.lava_active_count || 0);

    if (
      sourceAbilityId === "ukupanipo_feast_or_famine" &&
      terrain === "ocean" &&
      sourceCardId
    ) {
      const perCardCounts =
        ukupaCardWaterTileCounts.get(userId) || new Map<string, number>();
      const awardedCards =
        ukupaCardAwardedThisMatch.get(userId) || new Set<string>();

      const nextCount = (perCardCounts.get(sourceCardId) || 0) + 1;
      perCardCounts.set(sourceCardId, nextCount);
      ukupaCardWaterTileCounts.set(userId, perCardCounts);
      ukupaCardAwardedThisMatch.set(userId, awardedCards);

      if (nextCount >= 4 && !awardedCards.has(sourceCardId)) {
        awardedCards.add(sourceCardId);
        await this.incrementTieredCharacterAchievement(
          userId,
          CHARACTER_ACHIEVEMENT_BASE_KEYS.ukupa,
          1,
          result
        );
      }
    }

    if (
      sourceAbilityId === "nightmarchers_dread_aura" &&
      status === "cursed"
    ) {
      const next = (nightmarchersCursedTileCounts.get(userId) || 0) + 1;
      nightmarchersCursedTileCounts.set(userId, next);

      if (next >= 4 && !nightmarchersAwardedThisMatch.has(userId)) {
        nightmarchersAwardedThisMatch.add(userId);
        await this.incrementTieredCharacterAchievement(
          userId,
          CHARACTER_ACHIEVEMENT_BASE_KEYS.nightmarchers,
          1,
          result
        );
      }
    }

    if (sourceAbilityId === "kamapuaa_wild_shift" && terrain === "lava") {
      const isAbove = kamapuaaAboveThreshold.get(userId) === true;
      if (lavaActiveCount >= 4 && !isAbove) {
        kamapuaaAboveThreshold.set(userId, true);
        await this.incrementTieredCharacterAchievement(
          userId,
          CHARACTER_ACHIEVEMENT_BASE_KEYS.kamapuaa,
          1,
          result
        );
      } else if (lavaActiveCount < 4 && isAbove) {
        kamapuaaAboveThreshold.set(userId, false);
      }
    }
  },

  /**
   * Check if completing an achievement unlocks the next tier
   * Returns newly unlocked achievements
   */
  async checkAndUnlockNextTier(
    userId: string,
    completedAchievementKey: string
  ): Promise<UserAchievementWithDetails[]> {
    try {
      const completedAchievement = await AchievementModel.getAchievementByKey(
        completedAchievementKey
      );

      if (!completedAchievement || !completedAchievement.base_achievement_key) {
        return []; // Not a tiered achievement or doesn't exist
      }

      // Get the next tier (current tier + 1)
      const nextTierLevel = (completedAchievement.tier_level || 0) + 1;
      const allTiers = await AchievementModel.getTieredAchievementsByBaseKey(
        completedAchievement.base_achievement_key
      );

      const nextTier = allTiers.find(
        (tier) => tier.tier_level === nextTierLevel
      );

      if (!nextTier) {
        return []; // No next tier exists
      }

      // Check if next tier is already unlocked (should be, since we just completed the previous tier)
      const isUnlocked = await AchievementModel.isTierUnlocked(
        userId,
        nextTier.id
      );

      if (isUnlocked) {
        // Get the next tier achievement details with user progress
        const nextTierDetails = await AchievementModel.getUserAchievementByKey(
          userId,
          nextTier.achievement_key
        );

        if (nextTierDetails) {
          return [nextTierDetails];
        }
      }

      return [];
    } catch (error) {
      console.error(
        `Error checking tier unlock for ${completedAchievementKey}:`,
        error
      );
      return [];
    }
  },

  /**
   * Claim achievement rewards
   */
  async claimAchievementRewards(
    userId: string,
    achievementIds: string[]
  ): Promise<ClaimRewardsResult> {
    try {
      const claimedAchievements: UserAchievementWithDetails[] = [];
      const claimedAchievementRows: Achievement[] = [];

      // Mark each achievement as claimed and gather the reward configurations.
      // Currency and border granting is deferred to a single batched
      // RewardService call so we incur exactly one set of UPDATEs and a single
      // user fetch for post-grant balances.
      for (const achievementId of achievementIds) {
        const claimResult = await AchievementModel.claimAchievement(
          userId,
          achievementId
        );

        if (claimResult.success && claimResult.achievement) {
          claimedAchievementRows.push(claimResult.achievement);

          const achievementDetails =
            await AchievementModel.getUserAchievementByKey(
              userId,
              claimResult.achievement.achievement_key
            );

          if (achievementDetails) {
            claimedAchievements.push(achievementDetails);
          }
        }
      }

      const rewardItems = claimedAchievementRows.flatMap((a) =>
        achievementRewardsToItems({
          reward_gems: a.reward_gems,
          reward_fate_coins: a.reward_fate_coins,
          reward_packs: a.reward_packs,
          reward_card_fragments: a.reward_card_fragments,
          reward_border_id: a.reward_border_id ?? null,
          character_id:
            a.achievement_kind === "character" ? (a.character_id ?? null) : null,
        })
      );

      const grantResult = await RewardService.grantRewards(userId, rewardItems);

      const totalRewards = {
        gems: grantResult.totals.gems,
        fate_coins: grantResult.totals.fate_coins,
        packs: grantResult.totals.packs,
        card_fragments: grantResult.totals.card_fragments,
        borders: grantResult.totals.borders,
      };

      const updatedUser = await UserModel.findById(userId);

      const stats = await AchievementModel.getUserAchievementStats(userId);
      if (stats.completed_achievements >= 50) {
        await AchievementModel.setUserAchievementProgress(
          userId,
          "completionist",
          stats.completed_achievements
        );
      }

      return {
        success: grantResult.success,
        claimedAchievements,
        totalRewards,
        grantedItems: grantResult.granted,
        updatedCurrencies: {
          gems: updatedUser?.gems || 0,
          fate_coins: updatedUser?.fate_coins || 0,
          pack_count: updatedUser?.pack_count || 0,
          card_fragments: updatedUser?.card_fragments || 0,
          total_xp: updatedUser?.total_xp || 0,
        },
      };
    } catch (error) {
      console.error("Error claiming achievement rewards:", error);
      return {
        success: false,
        claimedAchievements: [],
        totalRewards: {
          gems: 0,
          fate_coins: 0,
          packs: 0,
          card_fragments: 0,
          borders: 0,
        },
      };
    }
  },

  /**
   * Get recently completed achievements
   */
  async getRecentlyCompletedAchievements(
    userId: string,
    limit: number = 5
  ): Promise<{
    success: boolean;
    achievements: UserAchievementWithDetails[];
  }> {
    try {
      const achievements =
        await AchievementModel.getRecentlyCompletedAchievements(userId, limit);

      return {
        success: true,
        achievements,
      };
    } catch (error) {
      console.error("Error fetching recently completed achievements:", error);
      return {
        success: false,
        achievements: [],
      };
    }
  },

  /**
   * Trigger achievement events from other services
   */
  async triggerAchievementEvent(
    event: AchievementProgressEvent
  ): Promise<UserAchievementWithDetails[]> {
    if (event.userId === AI_SYSTEM_USER_ID) {
      return [];
    }
    const result = await this.processAchievementProgress(event);
    return [...result.newlyCompleted, ...result.updatedProgress];
  },
};

export default AchievementService;
