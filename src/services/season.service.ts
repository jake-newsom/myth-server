import * as cron from "node-cron";
import SeasonModel, { SeasonDefinitionRow } from "../models/season.model";
import logger from "../utils/logger";

interface SeasonContext {
  off_season: boolean;
  current_season: SeasonDefinitionRow | null;
  next_season_start_at: Date | null;
}

const OFF_PERIOD_DAYS = 7;
const FUTURE_BUFFER_SEASONS = 2;

function getQuarterStartUtc(date: Date): Date {
  const year = date.getUTCFullYear();
  const quarterStartMonth = Math.floor(date.getUTCMonth() / 3) * 3;
  return new Date(Date.UTC(year, quarterStartMonth, 1, 0, 0, 0, 0));
}

function addQuarter(quarterStart: Date, offset: number): Date {
  return new Date(
    Date.UTC(
      quarterStart.getUTCFullYear(),
      quarterStart.getUTCMonth() + offset * 3,
      1,
      0,
      0,
      0,
      0
    )
  );
}

function buildSeasonWindow(quarterStart: Date): {
  seasonId: string;
  name: string;
  startAt: Date;
  endAt: Date;
} {
  const month = quarterStart.getUTCMonth();
  const quarter = Math.floor(month / 3) + 1;
  const year = quarterStart.getUTCFullYear();
  const seasonId = `${year}-Q${quarter}`;
  const startAt = new Date(
    Date.UTC(year, month, 1 + OFF_PERIOD_DAYS, 0, 0, 0, 0)
  );
  const endAt = addQuarter(quarterStart, 1);

  return {
    seasonId,
    name: `Season ${year} Q${quarter}`,
    startAt,
    endAt,
  };
}

const SeasonService = {
  maintenanceTask: null as cron.ScheduledTask | null,

  async initialize(): Promise<void> {
    try {
      await this.ensureSeasonBuffer(FUTURE_BUFFER_SEASONS);
      await SeasonModel.markStatuses();
      logger.info("Season system initialized");
    } catch (error) {
      logger.error(
        "Failed to initialize season system",
        {},
        error instanceof Error ? error : new Error(String(error))
      );
    }
  },

  startMaintenanceScheduler(): cron.ScheduledTask {
    if (this.maintenanceTask) {
      return this.maintenanceTask;
    }

    this.maintenanceTask = cron.schedule(
      "0 * * * *",
      async () => {
        try {
          await this.ensureSeasonBuffer(FUTURE_BUFFER_SEASONS);
          await SeasonModel.markStatuses();
        } catch (error) {
          logger.error(
            "Season maintenance scheduler failed",
            {},
            error instanceof Error ? error : new Error(String(error))
          );
        }
      },
      { timezone: "UTC" }
    );

    logger.info("Season maintenance scheduler started");
    return this.maintenanceTask;
  },

  stopMaintenanceScheduler(task?: cron.ScheduledTask | null): void {
    const target = task || this.maintenanceTask;
    if (!target) {
      return;
    }
    target.stop();
    target.destroy();
    if (this.maintenanceTask === target) {
      this.maintenanceTask = null;
    }
    logger.info("Season maintenance scheduler stopped");
  },

  async ensureSeasonBuffer(bufferSize: number = FUTURE_BUFFER_SEASONS): Promise<void> {
    const now = new Date();
    const currentQuarterStart = getQuarterStartUtc(now);
    const windows = [];
    for (let i = 0; i <= bufferSize; i++) {
      windows.push(buildSeasonWindow(addQuarter(currentQuarterStart, i)));
    }

    for (const window of windows) {
      const hasOverlap = await SeasonModel.hasOverlappingWindow(
        window.startAt,
        window.endAt,
        window.seasonId
      );
      if (hasOverlap) {
        continue;
      }

      await SeasonModel.upsertSeasonDefinition({
        seasonId: window.seasonId,
        name: window.name,
        startAt: window.startAt,
        endAt: window.endAt,
        generatedBy: "system",
        generationRuleVersion: 1,
      });
    }
  },

  async getCurrentSeasonContext(): Promise<SeasonContext> {
    await SeasonModel.markStatuses();

    const currentSeason = await SeasonModel.getActiveSeason();
    if (currentSeason) {
      return {
        off_season: false,
        current_season: currentSeason,
        next_season_start_at: null,
      };
    }

    const nextSeason = await SeasonModel.getNextSeason();
    return {
      off_season: true,
      current_season: null,
      next_season_start_at: nextSeason?.start_at || null,
    };
  },

  async getCurrentActiveSeason(): Promise<SeasonDefinitionRow | null> {
    await SeasonModel.markStatuses();
    return SeasonModel.getActiveSeason();
  },

  async listSeasons(limit: number = 20): Promise<SeasonDefinitionRow[]> {
    return SeasonModel.listSeasons(limit);
  },

  async updateSeasonDates(
    seasonId: string,
    startAt: Date,
    endAt: Date
  ): Promise<SeasonDefinitionRow> {
    if (!(startAt instanceof Date) || Number.isNaN(startAt.getTime())) {
      throw new Error("Invalid start_at timestamp");
    }
    if (!(endAt instanceof Date) || Number.isNaN(endAt.getTime())) {
      throw new Error("Invalid end_at timestamp");
    }
    if (startAt >= endAt) {
      throw new Error("start_at must be before end_at");
    }

    const hasOverlap = await SeasonModel.hasOverlappingWindow(
      startAt,
      endAt,
      seasonId
    );
    if (hasOverlap) {
      throw new Error("Updated season dates overlap an existing season window");
    }

    const updated = await SeasonModel.updateSeasonDates(seasonId, {
      startAt,
      endAt,
    });
    if (!updated) {
      throw new Error("Season not found");
    }

    return updated;
  },
};

export default SeasonService;
