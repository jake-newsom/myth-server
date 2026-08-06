import * as cron from "node-cron";
import FatePickService from "./fatePick.service";
import MailService from "./mail.service";
import db from "../config/db.config";

/**
 * Periodic data-retention jobs for the high-volume tables.
 *
 * Two distinct concerns live here:
 *
 * 1. **Expiry** — `cleanup_expired_fate_picks()` only flips flags
 *    (`fate_picks.is_active = false`, participations -> 'expired'). It deletes
 *    nothing. Running it matters because the fate-pick browse query filters on
 *    `is_active = true AND expires_at > NOW()`; without it, rows stay flagged
 *    active and the browse candidate set keeps growing.
 *
 * 2. **Purge** — actually reclaiming space. Expired fate picks are retained for
 *    FATE_PICK_RETENTION_DAYS so recent history stays visible, then deleted.
 *    Mail already has a real DELETE in `MailModel.cleanupExpiredMail`.
 *
 * Both jobs were previously dead code: the service methods existed but nothing
 * ever called them.
 */

const RETENTION_SCHEDULE = "15 3 * * *"; // 03:15 UTC daily, off the midnight cron pile-up

function retentionDays(): number {
  const parsed = Number(process.env.FATE_PICK_RETENTION_DAYS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

class DataRetentionService {
  private task: cron.ScheduledTask | null = null;
  private running = false;

  start(): cron.ScheduledTask {
    if (this.task) {
      console.log("[Data Retention] Service already running");
      return this.task;
    }

    this.task = cron.schedule(
      RETENTION_SCHEDULE,
      () => {
        void this.runOnce();
      },
      { timezone: "UTC" },
    );

    console.log(
      `[Data Retention] Scheduled daily at ${RETENTION_SCHEDULE} UTC ` +
        `(fate pick retention: ${retentionDays()} days)`,
    );
    return this.task;
  }

  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
      console.log("[Data Retention] Stopped");
    }
  }

  /**
   * Run one full retention pass. Safe to call manually.
   *
   * Guarded against overlap: a long purge must not stack with the next tick.
   * Each step is isolated so one failure doesn't skip the others.
   */
  async runOnce(): Promise<void> {
    if (this.running) {
      console.log("[Data Retention] Previous run still in progress, skipping");
      return;
    }
    this.running = true;

    try {
      await this.expireFatePicks();
      await this.purgeExpiredFatePicks();
      await this.purgeExpiredMail();
    } finally {
      this.running = false;
    }
  }

  /** Flip flags on expired picks/participations (no deletes). */
  private async expireFatePicks(): Promise<void> {
    try {
      const result = await FatePickService.cleanupExpired();
      if (!result.success) {
        console.error("[Data Retention] Fate pick expiry failed:", result.error);
        return;
      }
      const { expiredPicks = 0, expiredParticipations = 0 } =
        result.cleanup ?? {};
      console.log(
        `[Data Retention] Fate picks expired: ${expiredPicks} picks, ` +
          `${expiredParticipations} participations`,
      );
    } catch (error) {
      console.error("[Data Retention] Fate pick expiry threw:", error);
    }
  }

  /**
   * Delete long-expired fate picks. Participations cascade via their FK, but we
   * delete them explicitly first so the participant-count trigger doesn't fire
   * against rows that are on their way out.
   */
  private async purgeExpiredFatePicks(): Promise<void> {
    const days = retentionDays();
    const client = await db.getClient();
    try {
      await client.query("BEGIN");

      const { rows: participationRows } = await client.query(
        `DELETE FROM fate_pick_participations
          WHERE fate_pick_id IN (
            SELECT id FROM fate_picks
             WHERE is_active = false
               AND expires_at < NOW() - ($1 || ' days')::interval
          )
          RETURNING id;`,
        [String(days)],
      );

      const { rows: pickRows } = await client.query(
        `DELETE FROM fate_picks
          WHERE is_active = false
            AND expires_at < NOW() - ($1 || ' days')::interval
          RETURNING id;`,
        [String(days)],
      );

      await client.query("COMMIT");

      if (pickRows.length > 0 || participationRows.length > 0) {
        console.log(
          `[Data Retention] Purged ${pickRows.length} fate picks and ` +
            `${participationRows.length} participations older than ${days} days`,
        );
      }
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      console.error("[Data Retention] Fate pick purge failed:", error);
    } finally {
      client.release();
    }
  }

  /** Delete expired mail that is already claimed or carries no rewards. */
  private async purgeExpiredMail(): Promise<void> {
    try {
      const result = await MailService.cleanupExpiredMail();
      if (!result.success) {
        console.error("[Data Retention] Mail purge reported failure");
        return;
      }
      if (result.cleaned_count > 0) {
        console.log(
          `[Data Retention] Purged ${result.cleaned_count} expired mail rows`,
        );
      }
    } catch (error) {
      console.error("[Data Retention] Mail purge threw:", error);
    }
  }
}

export default new DataRetentionService();
