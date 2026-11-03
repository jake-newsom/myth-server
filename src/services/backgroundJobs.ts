/**
 * The one place every background job is started and stopped.
 *
 * Both entrypoints call this: `ts-node src/app.ts` (dev) and `node server.js`
 * (production, which only imports dist/app). Jobs used to be started inline in
 * each entrypoint, and the lists drifted: data retention, session cleanup, the
 * ember sweep, the feature flag cache sweeper, the midnight daily task and
 * blessing mail crons and IAP retries ran only in dev. Add new jobs HERE.
 *
 * Each job starts in its own try/catch so one failure can't skip the rest.
 * Starting twice is a no-op.
 */
import * as cron from "node-cron";
import StartupService from "./startup.service";
import SeasonService from "./season.service";
import SeasonSoulsService from "./seasonSouls.service";
import AIAutomationService from "./aiAutomation.service";
import SessionCleanupService from "./sessionCleanup.service";
import DataRetentionService from "./dataRetention.service";
import EmberService from "./ember.service";
import FeatureFlagService from "./featureFlag.service";
import DailyRewardsService from "./dailyRewards.service";
import DailyTaskService from "./dailyTask.service";
import { startIapRetries, stopIapRetries } from "./iap.service";
import { sendBlessingDailyMail } from "./blessing.service";
import {
  startRankedDraftScheduler,
  stopRankedDraftScheduler,
} from "./rankedDraftScheduler.service";
import { startUniqueFrameScheduler } from "./uniqueFrame.service";
import { monitorCronTask, reportJobError } from "../utils/telemetry";

let started = false;
let seasonMaintenance: cron.ScheduledTask | null = null;
let fatePickScheduler: cron.ScheduledTask | null = null;
let dailyRewardsTasks: cron.ScheduledTask[] = [];
let dailyTaskCron: cron.ScheduledTask | null = null;
let blessingMailCron: cron.ScheduledTask | null = null;

async function step(name: string, fn: () => unknown | Promise<unknown>) {
  try {
    await fn();
    console.log(`✅ [Jobs] ${name} started`);
  } catch (error) {
    console.error(`❌ [Jobs] ${name} failed to start:`, error);
    reportJobError(`start_${name.toLowerCase().replace(/\W+/g, "_")}`, error);
  }
}

export async function startBackgroundJobs(): Promise<void> {
  if (started) return;
  started = true;

  // Startup and season setup first: later jobs assume the season exists.
  await step("Startup initialization", () => StartupService.initialize());
  await step("Season services", async () => {
    await SeasonService.initialize();
    seasonMaintenance = SeasonService.startMaintenanceScheduler();
    SeasonSoulsService.start();
  });

  await step("Fate pick automation", () => {
    fatePickScheduler = AIAutomationService.startAutomatedFatePickScheduler();
  });
  await step("Ranked Draft scheduler", () => startRankedDraftScheduler());
  await step("Unique frame scheduler", () => startUniqueFrameScheduler());
  await step("Daily rewards and shop", () => {
    dailyRewardsTasks = DailyRewardsService.startDailyRewardsScheduler();
  });
  await step("IAP retries", () => startIapRetries());
  await step("Session cleanup", () => SessionCleanupService.start());
  await step("Data retention", () => DataRetentionService.start());
  await step("Ember regeneration", () => EmberService.start());
  await step("Feature flag cache sweeper", () =>
    FeatureFlagService.startCacheSweeper(),
  );

  await step("Daily task selection", async () => {
    await DailyTaskService.ensureTodaySelection();
    dailyTaskCron = monitorCronTask(
      cron.schedule(
        "0 0 * * *",
        async () => {
          await DailyTaskService.generateTomorrowSelection();
        },
        { timezone: "UTC" },
      ),
      "daily_task_selection",
    );
  });
  await step("Blessing daily mail", () => {
    blessingMailCron = cron.schedule(
      "0 0 * * *",
      async () => {
        try {
          await sendBlessingDailyMail();
        } catch (error) {
          console.error("❌ Failed to send blessing mail:", error);
          reportJobError("blessing_daily_mail", error);
        }
      },
      { timezone: "UTC" },
    );
  });
}

/** Stops every job and flushes Season Souls. Never throws. */
export async function stopBackgroundJobs(): Promise<void> {
  const quiet = (fn: () => unknown) => {
    try {
      fn();
    } catch (error) {
      console.error("⚠️ [Jobs] stop failed:", error);
    }
  };
  quiet(() => stopRankedDraftScheduler());
  quiet(() => stopIapRetries());
  if (fatePickScheduler) {
    const task = fatePickScheduler;
    quiet(() => AIAutomationService.stopAutomatedFatePickScheduler(task));
  }
  if (dailyRewardsTasks.length > 0) {
    const tasks = dailyRewardsTasks;
    quiet(() => DailyRewardsService.stopDailyRewardsScheduler(tasks));
  }
  quiet(() => dailyTaskCron?.stop());
  quiet(() => blessingMailCron?.stop());
  if (seasonMaintenance) {
    const task = seasonMaintenance;
    quiet(() => SeasonService.stopMaintenanceScheduler(task));
  }
  try {
    await SeasonSoulsService.flushNow();
  } catch (error) {
    console.error("⚠️ Failed to flush season souls:", error);
  }
  quiet(() => SeasonSoulsService.stop());
  quiet(() => SessionCleanupService.stop());
  quiet(() => DataRetentionService.stop());
  quiet(() => EmberService.stop());
  quiet(() => FeatureFlagService.stopCacheSweeper());
}
