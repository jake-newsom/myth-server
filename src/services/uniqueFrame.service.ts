import * as cron from "node-cron";
import db, { QueryExecutor } from "../config/db.config";
import { RANKED_DRAFT_SEASON_PREFIX } from "../config/constants";
import LeaderboardModel from "../models/leaderboard.model";
import logger from "../utils/logger";

/**
 * "One Frame to Rule Them All": an avatar frame held by exactly one player.
 *
 * - It is unclaimed (holder NULL) until the first Ranked Draft win claims it.
 * - The holder losing a Ranked Draft game passes it to the winner.
 * - A holder with no Ranked Draft game in 7 days loses it to the highest rated
 *   player on the current Ranked Draft ladder who HAS played in that window.
 *
 * The holder lives in unique_frame_holders (row-locked for every move), so two
 * games finishing at once can never both take it.
 */

export const INACTIVITY_DAYS = 7;

/** Granted permanently to anyone who loses the One Frame. */
export const FALLEN_FRAME_CODE = "fallen_sovereign";

type TransferReason = "claim" | "defeat" | "inactivity" | "admin" | "release";

const UniqueFrameService = {
  /**
   * Move a unique frame to `toUserId` (or release it with null). Must run
   * inside a transaction on `client`; the caller holds the row lock via
   * lockHolder. Unequips it from the previous holder and auto-equips it on
   * the new one.
   */
  async transfer(
    client: QueryExecutor,
    frameId: string,
    fromUserId: string | null,
    toUserId: string | null,
    reason: TransferReason,
    gameId: string | null = null
  ): Promise<void> {
    await client.query(
      `UPDATE unique_frame_holders
          SET user_id = $2, acquired_at = now(), acquired_via = $3
        WHERE frame_id = $1`,
      [frameId, toUserId, reason]
    );
    if (fromUserId && reason !== "release") {
      // Losing it leaves a permanent keepsake.
      await client.query(
        `INSERT INTO user_owned_frames (user_id, frame_id, source)
         SELECT $1, frame_id, 'one_frame_lost' FROM avatar_frames
          WHERE code_key = $2
         ON CONFLICT DO NOTHING`,
        [fromUserId, FALLEN_FRAME_CODE]
      );
    }
    if (fromUserId) {
      await client.query(
        `UPDATE users SET equipped_frame_id = NULL
          WHERE user_id = $1 AND equipped_frame_id = $2`,
        [fromUserId, frameId]
      );
    }
    if (toUserId) {
      await client.query(
        `UPDATE users SET equipped_frame_id = $2 WHERE user_id = $1`,
        [toUserId, frameId]
      );
    }
    await client.query(
      `INSERT INTO unique_frame_history (frame_id, from_user_id, to_user_id, reason, game_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [frameId, fromUserId, toUserId, reason, gameId]
    );
    await notify(client, frameId, fromUserId, toUserId, reason);
  },

  /** Run `fn` for each unique frame holder row, locked, in one transaction. */
  async withLockedHolders(
    fn: (
      client: QueryExecutor,
      holder: { frame_id: string; user_id: string | null }
    ) => Promise<void>
  ): Promise<void> {
    const client = await db.getClient();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `SELECT frame_id, user_id FROM unique_frame_holders
          ORDER BY frame_id FOR UPDATE`
      );
      for (const row of rows) await fn(client, row);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  },

  /** Called once per completed Ranked Draft game that has a winner. */
  async onRankedGameCompleted(
    winnerId: string,
    loserId: string,
    gameId: string
  ): Promise<void> {
    await this.withLockedHolders(async (client, holder) => {
      if (holder.user_id === null) {
        await this.transfer(client, holder.frame_id, null, winnerId, "claim", gameId);
      } else if (holder.user_id === loserId) {
        await this.transfer(client, holder.frame_id, loserId, winnerId, "defeat", gameId);
      }
    });
  },

  /** Hourly: pass the frame on if its holder has gone 7 days without ranked play. */
  async runInactivitySweep(): Promise<void> {
    const season = LeaderboardModel.getRankedDraftSeason();
    await this.withLockedHolders(async (client, holder) => {
      if (!holder.user_id) return;

      const { rows: lastRows } = await client.query(
        `SELECT MAX(last_game_at) AS last_game_at
           FROM user_rankings
          WHERE user_id = $1 AND season LIKE $2`,
        [holder.user_id, `${RANKED_DRAFT_SEASON_PREFIX}%`]
      );
      const last: Date | null = lastRows[0]?.last_game_at ?? null;
      const { rows: heldRows } = await client.query(
        `SELECT acquired_at FROM unique_frame_holders WHERE frame_id = $1`,
        [holder.frame_id]
      );
      // The clock starts no earlier than when they got the frame, so a fresh
      // inactivity recipient isn't immediately swept again.
      const acquired: Date | null = heldRows[0]?.acquired_at ?? null;
      const activeSince = [last, acquired]
        .filter((d): d is Date => !!d)
        .reduce<number>((max, d) => Math.max(max, new Date(d).getTime()), 0);
      if (Date.now() - activeSince < INACTIVITY_DAYS * 86_400_000) return;

      const { rows: next } = await client.query(
        `SELECT ur.user_id FROM user_rankings ur
           JOIN users u ON u.user_id = ur.user_id
          WHERE ur.season = $1 AND ur.user_id <> $2
            AND ur.last_game_at > now() - ($3 || ' days')::interval
            AND u.banned_at IS NULL
          ORDER BY ur.rating DESC, ur.last_game_at DESC
          LIMIT 1`,
        [season, holder.user_id, String(INACTIVITY_DAYS)]
      );
      if (!next[0]) return; // nobody eligible; the holder keeps it
      await this.transfer(client, holder.frame_id, holder.user_id, next[0].user_id, "inactivity");
    });
  },

  /** Account reset/delete: the frame is released for the next ranked winner. */
  async releaseIfHeld(client: QueryExecutor, userId: string): Promise<void> {
    const { rows } = await client.query(
      `SELECT frame_id FROM unique_frame_holders WHERE user_id = $1 FOR UPDATE`,
      [userId]
    );
    for (const row of rows) {
      await this.transfer(client, row.frame_id, userId, null, "release");
    }
  },
};

async function notify(
  client: QueryExecutor,
  frameId: string,
  fromUserId: string | null,
  toUserId: string | null,
  reason: TransferReason
): Promise<void> {
  const { rows } = await client.query(
    `SELECT f.name,
            (SELECT username FROM users WHERE user_id = $2) AS from_name,
            (SELECT username FROM users WHERE user_id = $3) AS to_name
       FROM avatar_frames f WHERE f.frame_id = $1`,
    [frameId, fromUserId, toUserId]
  );
  const { name, from_name, to_name } = rows[0] ?? {};
  if (!name) return;

  const send = (userId: string, subject: string, content: string) =>
    client.query(
      `INSERT INTO mail (user_id, mail_type, subject, content, sender_id, sender_name, has_rewards)
       VALUES ($1, 'system', $2, $3, NULL, 'Myth', false)`,
      [userId, subject, content]
    );

  if (toUserId) {
    const how =
      reason === "defeat"
        ? `You defeated ${from_name ?? "its holder"} and claimed it.`
        : reason === "inactivity"
          ? `${from_name ?? "Its holder"} went ${INACTIVITY_DAYS} days without a ranked match, and it passed to the highest ranked active player: you.`
          : `You are its first bearer.`;
    await send(
      toUserId,
      `You now hold ${name}`,
      `${how} It is equipped on your avatar. Lose a ranked match, or go ${INACTIVITY_DAYS} days without one, and it passes on.`
    );
  }
  if (fromUserId && reason !== "release") {
    const how =
      reason === "defeat"
        ? `${to_name ?? "Your opponent"} defeated you in a ranked match and took it.`
        : `You went ${INACTIVITY_DAYS} days without a ranked match, and it passed to ${to_name ?? "another player"}.`;
    await send(
      fromUserId,
      `You lost ${name}`,
      `${how} The Ring of the Fallen Sovereign is yours to keep. Win the One Frame back by defeating its holder.`
    );
  }
}

let scheduled = false;

/**
 * Idempotent. Started from BOTH entrypoints (app.ts dev, server.js prod) —
 * app.ts's require.main block never runs in production.
 */
export function startUniqueFrameScheduler(): void {
  if (scheduled) return;
  scheduled = true;
  cron.schedule("17 * * * *", async () => {
    try {
      await UniqueFrameService.runInactivitySweep();
    } catch (error) {
      logger.error("[uniqueFrame] inactivity sweep failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

export default UniqueFrameService;
