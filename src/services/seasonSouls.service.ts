import SeasonSoulsModel, { SeasonOverallLeaderboardEntry } from "../models/seasonSouls.model";
import SeasonRewardTierModel, {
  SeasonRewardBundle,
  SeasonRewardTierRow,
  ResolvedRewardAssets,
  ResolvedRewardCard,
  ResolvedRewardBorder,
  ResolvedRewardCardBack,
} from "../models/seasonRewardTier.model";
import SetModel from "../models/set.model";
import SeasonService from "./season.service";
import { MIN_SOULS_FOR_REWARDS } from "../config/constants";
import logger from "../utils/logger";

const SOUL_FLUSH_INTERVAL_MS = 10000;

interface SeasonRewardTierView {
  tier_key: string;
  label: string;
  threshold_kind: "exact_rank" | "percentile";
  threshold_value: number;
  bundle: SeasonRewardBundle;
  /** Display data for the bundle's asset IDs (empty arrays until ids assigned). */
  resolved: ResolvedRewardAssets;
}

function toTierView(
  t: SeasonRewardTierRow,
  lookups: {
    cards: Map<string, ResolvedRewardCard>;
    borders: Map<string, ResolvedRewardBorder>;
    cardBacks: Map<string, ResolvedRewardCardBack>;
  }
): SeasonRewardTierView {
  const b = t.bundle_json;
  return {
    tier_key: t.tier_key,
    label: t.label,
    threshold_kind: t.threshold_kind,
    threshold_value: t.threshold_value,
    bundle: b,
    resolved: {
      cards: b.card_variant_ids
        .map((id) => lookups.cards.get(id))
        .filter((x): x is ResolvedRewardCard => !!x),
      borders: b.border_ids
        .map((id) => lookups.borders.get(id))
        .filter((x): x is ResolvedRewardBorder => !!x),
      card_backs: b.card_back_ids
        .map((id) => lookups.cardBacks.get(id))
        .filter((x): x is ResolvedRewardCardBack => !!x),
    },
  };
}

class SeasonSoulsServiceClass {
  private pendingByUser = new Map<string, number>();
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing = false;

  start(): void {
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setInterval(() => {
      this.flushPendingSouls().catch((error) => {
        logger.error(
          "Failed to flush pending season souls",
          {},
          error instanceof Error ? error : new Error(String(error))
        );
      });
    }, SOUL_FLUSH_INTERVAL_MS);

    logger.info("Season souls tracker started", {
      flush_interval_ms: SOUL_FLUSH_INTERVAL_MS,
    });
  }

  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  async flushNow(): Promise<void> {
    await this.flushPendingSouls();
  }

  trackDefeat(userId: string, count: number = 1): void {
    if (!userId || count <= 0) {
      return;
    }
    this.pendingByUser.set(userId, (this.pendingByUser.get(userId) || 0) + count);
  }

  async flushPendingSouls(): Promise<void> {
    if (this.isFlushing || this.pendingByUser.size === 0) {
      return;
    }

    this.isFlushing = true;
    const snapshot = this.pendingByUser;
    this.pendingByUser = new Map<string, number>();

    try {
      const activeSeason = await SeasonService.getCurrentActiveSeason();
      if (!activeSeason) {
        return;
      }

      const userIds = Array.from(snapshot.keys());
      const choices = await SeasonSoulsModel.getChoicesForUsers(
        activeSeason.season_id,
        userIds
      );
      if (choices.length === 0) {
        return;
      }

      const choiceByUser = new Map<string, string>();
      for (const choice of choices) {
        choiceByUser.set(choice.user_id, choice.set_id);
      }

      const rows: Array<{ userId: string; setId: string; souls: number }> = [];
      for (const [userId, souls] of snapshot.entries()) {
        const setId = choiceByUser.get(userId);
        if (!setId) {
          continue;
        }

        rows.push({ userId, setId, souls });
      }

      if (rows.length === 0) {
        return;
      }

      await SeasonSoulsModel.upsertSoulContributions(activeSeason.season_id, rows);
    } catch (error) {
      for (const [userId, souls] of snapshot.entries()) {
        this.pendingByUser.set(userId, (this.pendingByUser.get(userId) || 0) + souls);
      }
      throw error;
    } finally {
      this.isFlushing = false;
    }
  }

  async getCurrentSeasonSummary(userId?: string): Promise<{
    off_season: boolean;
    current_season: {
      season_id: string;
      name: string;
      start_at: Date;
      end_at: Date;
      status: string;
    } | null;
    next_season_start_at: Date | null;
    requires_choice?: boolean;
  }> {
    const context = await SeasonService.getCurrentSeasonContext();
    if (context.off_season || !context.current_season) {
      return {
        off_season: true,
        current_season: null,
        next_season_start_at: context.next_season_start_at,
      };
    }

    let requiresChoice: boolean | undefined;
    if (userId) {
      const choice = await SeasonSoulsModel.getChoice(
        userId,
        context.current_season.season_id
      );
      requiresChoice = !choice;
    }

    return {
      off_season: false,
      current_season: {
        season_id: context.current_season.season_id,
        name: context.current_season.name,
        start_at: context.current_season.start_at,
        end_at: context.current_season.end_at,
        status: context.current_season.status,
      },
      next_season_start_at: null,
      ...(requiresChoice !== undefined ? { requires_choice: requiresChoice } : {}),
    };
  }

  async chooseMythology(userId: string, setId: string): Promise<{
    season_id: string;
    set_id: string;
    locked_at: Date;
  }> {
    const activeSeason = await SeasonService.getCurrentActiveSeason();
    if (!activeSeason) {
      throw new Error("No active season. Mythology selection is unavailable.");
    }

    const set = await SetModel.findById(setId);
    if (!set || !set.is_released) {
      throw new Error("Selected mythology set is not available.");
    }

    const created = await SeasonSoulsModel.createChoice(
      userId,
      activeSeason.season_id,
      setId
    );

    if (!created) {
      const existing = await SeasonSoulsModel.getChoice(
        userId,
        activeSeason.season_id
      );
      if (existing) {
        throw new Error("Mythology choice is already locked for this season.");
      }
      throw new Error("Failed to lock mythology choice.");
    }

    return {
      season_id: created.season_id,
      set_id: created.set_id,
      locked_at: created.locked_at,
    };
  }

  async getMyChoice(userId: string): Promise<{
    off_season: boolean;
    season_id: string | null;
    choice: { set_id: string; locked_at: Date } | null;
  }> {
    const activeSeason = await SeasonService.getCurrentActiveSeason();
    if (!activeSeason) {
      return {
        off_season: true,
        season_id: null,
        choice: null,
      };
    }

    const choice = await SeasonSoulsModel.getChoice(userId, activeSeason.season_id);
    return {
      off_season: false,
      season_id: activeSeason.season_id,
      choice: choice
        ? {
            set_id: choice.set_id,
            locked_at: choice.locked_at,
          }
        : null,
    };
  }

  async getCurrentStandings(): Promise<{
    off_season: boolean;
    season_id: string | null;
    standings: Array<{
      set_id: string;
      set_name: string;
      image_url: string | null;
      souls_total: number;
      placement: number;
    }>;
  }> {
    const activeSeason = await SeasonService.getCurrentActiveSeason();
    if (!activeSeason) {
      return {
        off_season: true,
        season_id: null,
        standings: [],
      };
    }

    const standings = await SeasonSoulsModel.getSeasonStandings(activeSeason.season_id);
    return {
      off_season: false,
      season_id: activeSeason.season_id,
      standings,
    };
  }

  /**
   * Reward tiers for the active season on both axes (season overrides, else
   * template), in prestige order. The `overall` axis is evaluated against a
   * player's rank across all players; the `pantheon` axis against their chosen
   * pantheon's placement in the faction race. The client highlights the
   * matching tier in each section.
   */
  async getRewardTiers(): Promise<{
    off_season: boolean;
    season_id: string | null;
    overall: SeasonRewardTierView[];
    pantheon: SeasonRewardTierView[];
  }> {
    const activeSeason = await SeasonService.getCurrentActiveSeason();
    if (!activeSeason) {
      return { off_season: true, season_id: null, overall: [], pantheon: [] };
    }

    const [overallRows, pantheonRows] = await Promise.all([
      SeasonRewardTierModel.getTiersForSeason(activeSeason.season_id, "overall"),
      SeasonRewardTierModel.getTiersForSeason(activeSeason.season_id, "pantheon"),
    ]);

    // Resolve all referenced asset ids (cards/borders/backs) to display data
    // so the modal can render real card/border/back previews.
    const lookups = await SeasonRewardTierModel.resolveAssetsForBundles([
      ...overallRows.map((t) => t.bundle_json),
      ...pantheonRows.map((t) => t.bundle_json),
    ]);

    return {
      off_season: false,
      season_id: activeSeason.season_id,
      overall: overallRows.map((t) => toTierView(t, lookups)),
      pantheon: pantheonRows.map((t) => toTierView(t, lookups)),
    };
  }

  async getMySeasonProgress(userId: string): Promise<{
    off_season: boolean;
    season_id: string | null;
    choice_set_id: string | null;
    souls_total: number;
    rank: number | null;
    total_players: number;
    rank_percentile: number | null;
    eligible_for_rewards: boolean;
    minimum_souls_for_rewards: number;
    // For the rewards modal's two axes:
    overall_rank: number | null; // personal rank across all players
    overall_total_ranked: number;
    pantheon_placement: number | null; // chosen pantheon's faction-race finish
  }> {
    const activeSeason = await SeasonService.getCurrentActiveSeason();
    if (!activeSeason) {
      return {
        off_season: true,
        season_id: null,
        choice_set_id: null,
        souls_total: 0,
        rank: null,
        total_players: 0,
        rank_percentile: null,
        eligible_for_rewards: false,
        minimum_souls_for_rewards: MIN_SOULS_FOR_REWARDS,
        overall_rank: null,
        overall_total_ranked: 0,
        pantheon_placement: null,
      };
    }

    const stats = await SeasonSoulsModel.getUserSeasonStats(
      userId,
      activeSeason.season_id
    );

    let rankPercentile: number | null = null;
    if (stats.rank && stats.totalPlayers > 0) {
      rankPercentile = Number(
        (((stats.totalPlayers - stats.rank + 1) / stats.totalPlayers) * 100).toFixed(
          2
        )
      );
    }

    // Overall personal rank + the player's pantheon placement (for reward axes).
    const overall = await SeasonSoulsModel.getUserOverallRank(
      userId,
      activeSeason.season_id
    );
    let pantheonPlacement: number | null = null;
    if (stats.choice?.set_id) {
      const standings = await SeasonSoulsModel.getSeasonStandings(
        activeSeason.season_id
      );
      pantheonPlacement =
        standings.find((s) => s.set_id === stats.choice?.set_id)?.placement ??
        null;
    }

    return {
      off_season: false,
      season_id: activeSeason.season_id,
      choice_set_id: stats.choice?.set_id || null,
      souls_total: stats.soulsTotal,
      rank: stats.rank,
      total_players: stats.totalPlayers,
      rank_percentile: rankPercentile,
      eligible_for_rewards: stats.soulsTotal >= MIN_SOULS_FOR_REWARDS,
      minimum_souls_for_rewards: MIN_SOULS_FOR_REWARDS,
      overall_rank: overall.rank,
      overall_total_ranked: overall.total_ranked,
      pantheon_placement: pantheonPlacement,
    };
  }

  async getOverallLeaderboard(
    page: number = 1,
    limit: number = 50
  ): Promise<{
    off_season: boolean;
    season_id: string | null;
    leaderboard: SeasonOverallLeaderboardEntry[];
    pagination: {
      current_page: number;
      total_pages: number;
      total_players: number;
      per_page: number;
    };
  }> {
    const activeSeason = await SeasonService.getCurrentActiveSeason();
    if (!activeSeason) {
      return {
        off_season: true,
        season_id: null,
        leaderboard: [],
        pagination: {
          current_page: page,
          total_pages: 0,
          total_players: 0,
          per_page: limit,
        },
      };
    }

    const normalizedPage = Math.max(1, page);
    const normalizedLimit = Math.min(Math.max(1, limit), 100);

    const result = await SeasonSoulsModel.getOverallLeaderboardPaginated(
      activeSeason.season_id,
      normalizedPage,
      normalizedLimit
    );

    const totalPages =
      result.total_players === 0
        ? 0
        : Math.ceil(result.total_players / normalizedLimit);

    return {
      off_season: false,
      season_id: activeSeason.season_id,
      leaderboard: result.entries,
      pagination: {
        current_page: normalizedPage,
        total_pages: totalPages,
        total_players: result.total_players,
        per_page: normalizedLimit,
      },
    };
  }

  async getMyRewardStatus(userId: string): Promise<{
    off_season: boolean;
    season_id: string | null;
    reward_status: {
      status: "pending" | "sent" | "claimed" | "failed";
      bundle: Record<string, any>;
      mail_id: string | null;
      updated_at: Date;
    } | null;
  }> {
    const activeSeason = await SeasonService.getCurrentActiveSeason();
    if (!activeSeason) {
      return {
        off_season: true,
        season_id: null,
        reward_status: null,
      };
    }

    const rewardStatus = await SeasonSoulsModel.getRewardStatus(
      userId,
      activeSeason.season_id
    );
    return {
      off_season: false,
      season_id: activeSeason.season_id,
      reward_status: rewardStatus
        ? {
            status: rewardStatus.status,
            bundle: rewardStatus.bundle_json || {},
            mail_id: rewardStatus.mail_id,
            updated_at: rewardStatus.updated_at,
          }
        : null,
    };
  }

  async getCurrentSetLeaderboard(
    setId: string,
    page: number = 1,
    limit: number = 50
  ): Promise<{
    off_season: boolean;
    season_id: string | null;
    set_id: string;
    leaderboard: Array<{
      user_id: string;
      username: string;
      souls_total: number;
      rank: number;
    }>;
    pagination: {
      current_page: number;
      total_pages: number;
      total_players: number;
      per_page: number;
    };
  }> {
    const activeSeason = await SeasonService.getCurrentActiveSeason();
    if (!activeSeason) {
      return {
        off_season: true,
        season_id: null,
        set_id: setId,
        leaderboard: [],
        pagination: {
          current_page: page,
          total_pages: 0,
          total_players: 0,
          per_page: limit,
        },
      };
    }

    const set = await SetModel.findById(setId);
    if (!set || !set.is_released) {
      throw new Error("Selected mythology set is not available.");
    }

    const normalizedPage = Math.max(1, page);
    const normalizedLimit = Math.min(Math.max(1, limit), 100);

    const leaderboardPage = await SeasonSoulsModel.getContributorsForSetPaginated(
      activeSeason.season_id,
      setId,
      normalizedPage,
      normalizedLimit
    );

    const totalPages =
      leaderboardPage.total_players === 0
        ? 0
        : Math.ceil(leaderboardPage.total_players / normalizedLimit);

    return {
      off_season: false,
      season_id: activeSeason.season_id,
      set_id: setId,
      leaderboard: leaderboardPage.entries.map((entry) => ({
        user_id: entry.user_id,
        username: entry.username,
        souls_total: entry.souls_total,
        rank: entry.rank,
      })),
      pagination: {
        current_page: normalizedPage,
        total_pages: totalPages,
        total_players: leaderboardPage.total_players,
        per_page: normalizedLimit,
      },
    };
  }
}

const SeasonSoulsService = new SeasonSoulsServiceClass();

export default SeasonSoulsService;
