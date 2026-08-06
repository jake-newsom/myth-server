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
 * 3. **Game state clearing** — `games.game_state` is a full board/hand/event
 *    blob that nothing reads once a game is terminal (there is no history or
 *    replay feature; long-term stats live in `game_results`). We blank it
 *    rather than deleting the row: `game_results.game_id` is ON DELETE CASCADE,
 *    so purging `games` rows would destroy the rating history the leaderboards
 *    depend on. Blanking reclaims effectively all the row weight — the JSONB is
 *    TOASTed and the scalar columns are trivial — with no referential risk.
 *
 * The fate pick and mail jobs were previously dead code: the service methods
 * existed but nothing ever called them.
 */

const RETENTION_SCHEDULE = "15 3 * * *"; // 03:15 UTC daily, off the midnight cron pile-up

/** Statuses a game can never leave. Confirmed against the game_status enum. */
const TERMINAL_GAME_STATUSES = ["completed", "rewarded", "aborted"];

/** Rows cleared per statement, so a large backlog can't trip statement_timeout. */
const GAME_STATE_BATCH_SIZE = 5_000;

function retentionDays(): number {
  const parsed = Number(process.env.FATE_PICK_RETENTION_DAYS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

/**
 * Age floor before a terminal game's state is cleared. Guards the reconnect
 * window: a client that hasn't navigated away may still refetch a game it just
 * finished. Default 48h.
 */
function gameStateRetentionHours(): number {
  const parsed = Number(process.env.GAME_STATE_RETENTION_HOURS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 48;
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
      await this.clearTerminalGameState();
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

  /**
   * Blank `game_state` on terminal games past the age floor.
   *
   * Notes on the predicate:
   * - Only terminal statuses. An old `active` row may still be a resumable
   *   game, and clearing its state would destroy a live game.
   * - Age is keyed on COALESCE(completed_at, created_at): `completed_at` is set
   *   by a CASE in updateGameAfterAction that only fires for 'completed', so a
   *   row that reached a terminal status another way can have it NULL. Without
   *   the COALESCE those rows would compare NULL and never be cleared.
   * - `game_state <> '{}'` makes the job idempotent — re-runs skip rows already
   *   cleared instead of rewriting them (and bloating the heap for nothing).
   *
   * The column is NOT NULL with default '{}', so we write the empty object
   * rather than NULL; no schema change needed.
   */
  private async clearTerminalGameState(): Promise<void> {
    const hours = gameStateRetentionHours();
    let totalCleared = 0;

    try {
      // Batched so a large backlog can't exceed statement_timeout (15s). Each
      // batch is its own autocommit statement; partial progress is fine and the
      // next run picks up where this one stopped.
      for (;;) {
        const { rows } = await db.query(
          `UPDATE games
              SET game_state = '{}'::jsonb
            WHERE game_id IN (
              SELECT game_id FROM games
               WHERE game_status = ANY($1::game_status[])
                 AND game_state <> '{}'::jsonb
                 AND COALESCE(completed_at, created_at) < NOW() - ($2 || ' hours')::interval
               LIMIT $3
            )
            RETURNING game_id;`,
          [TERMINAL_GAME_STATUSES, String(hours), GAME_STATE_BATCH_SIZE],
        );

        totalCleared += rows.length;
        if (rows.length < GAME_STATE_BATCH_SIZE) break;
      }

      if (totalCleared > 0) {
        console.log(
          `[Data Retention] Cleared game_state on ${totalCleared} terminal ` +
            `games older than ${hours}h`,
        );
      }
    } catch (error) {
      console.error("[Data Retention] Game state clearing failed:", error);
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
