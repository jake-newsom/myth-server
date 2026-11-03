import * as cron from "node-cron";
import FatePickService from "./fatePick.service";
import MailService from "./mail.service";
import RiddleService from "./riddle.service";
import db from "../config/db.config";
import { recordGameCardResults } from "./gameCardResults.service";
import { recordGameReplay } from "./gameReplay.service";
import { GameState } from "../types/game.types";

const AI_PLAYER_ID = "00000000-0000-0000-0000-000000000000";

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
 *    replay view; long-term stats live in `game_results`). Before blanking,
 *    archiveFinishedGame saves per-card results (game_card_results, kept
 *    forever) and a compact replay (game_replays, kept 30 days). We blank it
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
export const TERMINAL_GAME_STATUSES = ["completed", "rewarded", "aborted"];

/**
 * Games archived then cleared per batch. Each state is ~70 KB raw and is read
 * back into Node to archive, so batches stay small.
 */
const GAME_STATE_BATCH_SIZE = 200;

/** Compact replay records (game_replays) are deleted after this many days. */
const REPLAY_RETENTION_DAYS = 30;

interface ArchivableGameRow {
  game_id: string;
  game_mode: string;
  player1_id: string | null;
  player2_id: string | null;
  winner_id: string | null;
  finished_at: Date;
  game_state: GameState | string;
}

/**
 * Saves what we keep long-term from a finished game before its full state is
 * blanked: one game_card_results row per card for each human player (forever)
 * and the compact replay record (30 days). Both writes are idempotent, so
 * games already recorded at completion are untouched.
 */
export async function archiveFinishedGame(row: ArchivableGameRow): Promise<void> {
  const state: GameState =
    typeof row.game_state === "string" ? JSON.parse(row.game_state) : row.game_state;
  if (!state?.player1) return; // already blank or malformed; nothing to keep
  for (const userId of [row.player1_id, row.player2_id]) {
    if (!userId || userId === AI_PLAYER_ID) continue;
    await recordGameCardResults({
      gameId: row.game_id,
      userId,
      gameMode: row.game_mode,
      gameState: state,
      winner: row.winner_id ?? state.winner ?? null,
      createdAt: row.finished_at,
    });
  }
  const ageDays = (Date.now() - new Date(row.finished_at).getTime()) / 86_400_000;
  if (ageDays >= REPLAY_RETENTION_DAYS) return; // would be purged at once
  await recordGameReplay({
    gameId: row.game_id,
    gameMode: row.game_mode,
    gameState: state,
    player1Id: row.player1_id,
    player2Id: row.player2_id,
    winnerId: row.winner_id ?? state.winner ?? null,
    finishedAt: row.finished_at,
  });
}

/** Terminal games that still hold a full state, oldest first. */
export const ARCHIVABLE_GAMES_SQL = `
  SELECT game_id, game_mode::text AS game_mode, player1_id, player2_id, winner_id,
         COALESCE(completed_at, created_at) AS finished_at, game_state
    FROM games
   WHERE game_status = ANY($1::game_status[])
     AND game_state <> '{}'::jsonb
     AND COALESCE(completed_at, created_at) < NOW() - ($2 || ' hours')::interval
     AND NOT (game_id = ANY($3::uuid[]))
   ORDER BY COALESCE(completed_at, created_at)
   LIMIT $4`;

function retentionDays(): number {
  const parsed = Number(process.env.FATE_PICK_RETENTION_DAYS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

/**
 * Age floor before a terminal game's state is cleared. Guards the reconnect
 * window: a client that hasn't navigated away may still refetch a game it just
 * finished. Default 7 days (168h).
 */
function gameStateRetentionHours(): number {
  const parsed = Number(process.env.GAME_STATE_RETENTION_HOURS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 168;
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
      await this.purgeOldReplays();
      await this.pruneRiddleAttempts();
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
    // Games whose archive failed this run: skipped (state kept) and retried
    // tomorrow, never blanked without their card results and replay.
    const failed: string[] = [];

    try {
      for (;;) {
        const { rows }: { rows: ArchivableGameRow[] } = await db.query(ARCHIVABLE_GAMES_SQL, [
          TERMINAL_GAME_STATUSES,
          String(hours),
          failed,
          GAME_STATE_BATCH_SIZE,
        ]);
        if (rows.length === 0) break;

        const archived: string[] = [];
        for (const row of rows) {
          try {
            await archiveFinishedGame(row);
            archived.push(row.game_id);
          } catch (error) {
            failed.push(row.game_id);
            console.error(
              `[Data Retention] Archiving game ${row.game_id} failed; keeping its state:`,
              error,
            );
          }
        }

        if (archived.length > 0) {
          const { rowCount } = await db.query(
            `UPDATE games SET game_state = '{}'::jsonb
              WHERE game_id = ANY($1::uuid[]) AND game_state <> '{}'::jsonb`,
            [archived],
          );
          totalCleared += rowCount ?? 0;
        }
        if (rows.length < GAME_STATE_BATCH_SIZE) break;
      }

      if (totalCleared > 0 || failed.length > 0) {
        console.log(
          `[Data Retention] Archived and cleared game_state on ${totalCleared} ` +
            `terminal games older than ${hours}h` +
            (failed.length ? `; ${failed.length} failed and were kept` : ""),
        );
      }
    } catch (error) {
      console.error("[Data Retention] Game state clearing failed:", error);
    }
  }

  /** Compact replays live REPLAY_RETENTION_DAYS; per-card results stay. */
  private async purgeOldReplays(): Promise<void> {
    try {
      const { rowCount } = await db.query(
        `DELETE FROM game_replays
          WHERE finished_at < NOW() - ($1 || ' days')::interval`,
        [String(REPLAY_RETENTION_DAYS)],
      );
      if (rowCount) {
        console.log(`[Data Retention] Deleted ${rowCount} replays older than ${REPLAY_RETENTION_DAYS} days`);
      }
    } catch (error) {
      console.error("[Data Retention] Replay purge failed:", error);
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

  /** Weekly Riddle play-throughs; per-week progress rows are kept. */
  private async pruneRiddleAttempts(): Promise<void> {
    try {
      const deleted = await RiddleService.pruneAttempts(90);
      if (deleted > 0) {
        console.log(`[Data Retention] Pruned ${deleted} old riddle attempts`);
      }
    } catch (error) {
      console.error("[Data Retention] Riddle attempt prune threw:", error);
    }
  }
}

export default new DataRetentionService();
