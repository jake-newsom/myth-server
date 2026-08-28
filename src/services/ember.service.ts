import * as cron from "node-cron";
import db, { QueryExecutor } from "../config/db.config";
import { EMBER_CONFIG, EMBERS_FLAG } from "../config/constants";
import logger from "../utils/logger";
import FeatureFlagService from "./featureFlag.service";

/**
 * Embers — the entry currency for solo and Ascendant's Spire games.
 *
 * ## Regeneration is lazy, with a sweep as a backstop
 *
 * Every read of a player's balance first settles whatever regeneration they are
 * owed (`settle`). That is what makes the balance and the client's countdown
 * correct at the instant they are looked at, regardless of when the periodic
 * sweep last ran — a player who has been away for six hours sees the right
 * number the moment they open the app, not ten minutes later.
 *
 * The sweep (`runOnce`, every 10 minutes) exists so the number is also right
 * for players who are *not* looking: leaderboards, admin views, and anything
 * that reads `users.embers` directly without going through this service. It is
 * the same arithmetic applied in bulk, so the two can never disagree.
 *
 * ## Why a high-water mark instead of "now"
 *
 * `embers_last_regen_at` advances by whole intervals only:
 *
 *     granted  = floor((now - last_regen_at) / interval)
 *     new_last = last_regen_at + granted * interval
 *
 * Setting it to `now()` instead would discard the partial progress toward the
 * next ember on every single read. Since reads happen constantly (every profile
 * fetch), a player who checked their balance more often than once per interval
 * would regenerate *nothing, ever*. The high-water mark makes settling
 * idempotent and read-frequency independent.
 *
 * ## The cap is a regeneration ceiling, not a maximum
 *
 * Regeneration stops contributing at REGEN_CAP, but purchases and rewards may
 * push a balance above it. Nothing here ever reduces a balance: a player
 * sitting on 120 bought embers keeps all 120, and simply regenerates none until
 * they spend back below 60. Every statement below is written as
 * `LEAST(cap, embers + granted)` guarded by `embers < cap`, never as a
 * `LEAST(cap, ...)` applied unconditionally, which would confiscate the
 * overflow.
 *
 * While a balance is at or above the cap the high-water mark is pushed forward
 * to now, so that time spent full does not bank into an instant refill the
 * moment one ember is spent.
 */

/** Runs on the interval embers regenerate on. */
const SWEEP_SCHEDULE = `*/${EMBER_CONFIG.REGEN_INTERVAL_MS / 60000} * * * *`;

/** Rows credited per statement, so a large backlog can't trip statement_timeout. */
const SWEEP_BATCH_SIZE = 5_000;

export interface EmberState {
  /** Current balance, after settling any regeneration owed. */
  embers: number;
  /**
   * Milliseconds until the next ember regenerates, or null when the balance is
   * at or above the regeneration cap and none is coming.
   */
  next_ember_in_ms: number | null;
  /** The regeneration ceiling, so the client need not hardcode it. */
  regen_cap: number;
  /** Milliseconds between regenerated embers, so the client can tick locally. */
  regen_interval_ms: number;
}

/**
 * Credits regeneration owed and returns the settled row.
 *
 * The whole calculation is one statement so it is atomic against concurrent
 * spends: a spend that lands between a read and a write cannot be lost, because
 * there is no read-then-write to interleave with.
 */
const SETTLE_SQL = `
  UPDATE users
     SET embers = CASE
           WHEN embers >= $2 THEN embers
           ELSE LEAST(
             $2,
             embers + FLOOR(EXTRACT(EPOCH FROM (NOW() - embers_last_regen_at)) * 1000 / $3)::int
           )
         END,
         embers_last_regen_at = CASE
           -- At or over the cap: hold the mark at now, so time spent full does
           -- not bank into an instant refill after the next spend.
           WHEN embers >= $2 THEN NOW()
           ELSE embers_last_regen_at + (
             FLOOR(EXTRACT(EPOCH FROM (NOW() - embers_last_regen_at)) * 1000 / $3)
             * INTERVAL '1 millisecond' * $3
           )
         END
   WHERE user_id = $1
  RETURNING embers, embers_last_regen_at
`;

class EmberService {
  private task: cron.ScheduledTask | null = null;
  private running = false;

  /**
   * Credit any regeneration this player is owed and return their state.
   *
   * Safe to call on every read: settling is idempotent within an interval.
   */
  async settle(
    userId: string,
    executor: QueryExecutor = db
  ): Promise<EmberState> {
    const { rows } = await executor.query(SETTLE_SQL, [
      userId,
      EMBER_CONFIG.REGEN_CAP,
      EMBER_CONFIG.REGEN_INTERVAL_MS,
    ]);

    if (rows.length === 0) {
      // No such user. Report an empty, non-regenerating meter rather than
      // throwing — every caller here is a read decorating a response.
      return {
        embers: 0,
        next_ember_in_ms: null,
        regen_cap: EMBER_CONFIG.REGEN_CAP,
        regen_interval_ms: EMBER_CONFIG.REGEN_INTERVAL_MS,
      };
    }

    return this.toState(rows[0].embers, rows[0].embers_last_regen_at);
  }

  /** Read the settled state without a write, for callers that already settled. */
  toState(embers: number, lastRegenAt: Date | string): EmberState {
    return {
      embers,
      next_ember_in_ms: this.nextEmberInMs(embers, lastRegenAt),
      regen_cap: EMBER_CONFIG.REGEN_CAP,
      regen_interval_ms: EMBER_CONFIG.REGEN_INTERVAL_MS,
    };
  }

  /**
   * Milliseconds until the next ember, or null when none is coming.
   *
   * Computed from the high-water mark rather than from "now + interval", so the
   * countdown reflects real progress toward the next ember instead of restarting
   * at a full interval on every poll.
   */
  private nextEmberInMs(
    embers: number,
    lastRegenAt: Date | string
  ): number | null {
    if (embers >= EMBER_CONFIG.REGEN_CAP) {
      return null;
    }

    const last = new Date(lastRegenAt).getTime();
    if (Number.isNaN(last)) {
      return EMBER_CONFIG.REGEN_INTERVAL_MS;
    }

    const elapsed = Date.now() - last;
    const remaining =
      EMBER_CONFIG.REGEN_INTERVAL_MS -
      (elapsed % EMBER_CONFIG.REGEN_INTERVAL_MS);

    // Clamp into (0, interval]. A clock skew that puts the mark in the future
    // must not produce a negative countdown.
    if (remaining <= 0 || remaining > EMBER_CONFIG.REGEN_INTERVAL_MS) {
      return EMBER_CONFIG.REGEN_INTERVAL_MS;
    }
    return remaining;
  }

  /**
   * Spend embers for a game, settling regeneration first.
   *
   * Returns whether the spend happened and the resulting balance. A `false`
   * result is an ordinary outcome, not an error: a player with no embers still
   * gets to play, their game just isn't ember funded.
   *
   * Settle-then-spend runs in one transaction so a player cannot spend an ember
   * they were about to regenerate twice over, and the spend itself is guarded by
   * `embers >= cost` in the WHERE clause so two concurrent game creations cannot
   * take the same last ember.
   */
  async trySpend(
    userId: string,
    amount: number = EMBER_CONFIG.GAME_COST,
    executor?: QueryExecutor
  ): Promise<{ spent: boolean; embers: number }> {
    const runOn = async (client: QueryExecutor) => {
      await this.settle(userId, client);

      const { rows } = await client.query(
        `UPDATE users SET embers = embers - $2
          WHERE user_id = $1 AND embers >= $2
        RETURNING embers`,
        [userId, amount]
      );

      if (rows.length > 0) {
        return { spent: true, embers: rows[0].embers as number };
      }

      const { rows: balanceRows } = await client.query(
        `SELECT embers FROM users WHERE user_id = $1`,
        [userId]
      );
      return { spent: false, embers: balanceRows[0]?.embers ?? 0 };
    };

    if (executor) {
      return runOn(executor);
    }

    const client = await db.getClient();
    try {
      await client.query("BEGIN");
      const result = await runOn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Grant embers from a purchase or reward.
   *
   * Deliberately uncapped — this is the path that is allowed to exceed
   * REGEN_CAP. Regeneration will idle until the balance falls back under it.
   */
  async grant(
    userId: string,
    amount: number,
    executor: QueryExecutor = db
  ): Promise<number> {
    if (amount <= 0) {
      const { rows } = await executor.query(
        `SELECT embers FROM users WHERE user_id = $1`,
        [userId]
      );
      return rows[0]?.embers ?? 0;
    }

    const { rows } = await executor.query(
      `UPDATE users SET embers = embers + $2
        WHERE user_id = $1
      RETURNING embers`,
      [userId, amount]
    );
    return rows[0]?.embers ?? 0;
  }

  // === Periodic sweep ===

  start(): cron.ScheduledTask {
    if (this.task) {
      return this.task;
    }

    this.task = cron.schedule(
      SWEEP_SCHEDULE,
      () => {
        void this.runOnce();
      },
      { timezone: "UTC" }
    );

    logger.info("Ember regeneration sweep started", {
      schedule: SWEEP_SCHEDULE,
      regen_cap: EMBER_CONFIG.REGEN_CAP,
    });

    return this.task;
  }

  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
  }

  /**
   * Credit regeneration to every player who is owed some.
   *
   * Only touches rows below the cap and past due by at least a full interval,
   * which is what the partial index on `embers_last_regen_at` is for. Batched so
   * a large idle population cannot produce one enormous statement.
   */
  async runOnce(): Promise<number> {
    if (this.running) {
      return 0;
    }
    this.running = true;

    let totalUpdated = 0;
    try {
      for (;;) {
        const { rowCount } = await db.query(
          `UPDATE users u
              SET embers = LEAST(
                    $1,
                    u.embers + FLOOR(EXTRACT(EPOCH FROM (NOW() - u.embers_last_regen_at)) * 1000 / $2)::int
                  ),
                  embers_last_regen_at = u.embers_last_regen_at + (
                    FLOOR(EXTRACT(EPOCH FROM (NOW() - u.embers_last_regen_at)) * 1000 / $2)
                    * INTERVAL '1 millisecond' * $2
                  )
            WHERE u.user_id IN (
              SELECT user_id FROM users
               WHERE embers < $1
                 AND embers_last_regen_at <= NOW() - ($2 * INTERVAL '1 millisecond')
               ORDER BY embers_last_regen_at
               LIMIT $3
            )`,
          [
            EMBER_CONFIG.REGEN_CAP,
            EMBER_CONFIG.REGEN_INTERVAL_MS,
            SWEEP_BATCH_SIZE,
          ]
        );

        totalUpdated += rowCount ?? 0;
        if ((rowCount ?? 0) < SWEEP_BATCH_SIZE) {
          break;
        }
      }

      if (totalUpdated > 0) {
        logger.debug("Ember regeneration swept", { users_credited: totalUpdated });
      }
    } catch (error) {
      logger.error(
        "Ember regeneration sweep failed",
        {},
        error instanceof Error ? error : new Error(String(error))
      );
    } finally {
      this.running = false;
    }

    return totalUpdated;
  }
}

const emberService = new EmberService();

/**
 * Spend the entry ember for a solo or tower game, honouring the feature flag.
 *
 * Returns whether the game is ember funded — i.e. whether it awards card XP and
 * contributes souls to the season total.
 *
 * With `embers-economy` off this always returns true and spends nothing, which
 * is exactly the behaviour that predates embers. That is the kill switch: turn
 * the flag off and every solo/tower game pays out as it always did, with no
 * redeploy.
 *
 * A failure to spend is deliberately non-fatal in both directions:
 *   - No embers left -> false. The player still gets their game.
 *   - The spend itself throws -> true, and we log. A database hiccup must not
 *     silently confiscate a player's XP; erring toward paying out is the
 *     forgiving failure, and it is the same outcome as the flag being off.
 */
export async function spendEmberForGame(userId: string): Promise<boolean> {
  try {
    const economyOn = await FeatureFlagService.isEnabled(userId, EMBERS_FLAG);
    if (!economyOn) {
      return true;
    }

    const { spent } = await emberService.trySpend(userId);
    return spent;
  } catch (error) {
    logger.error(
      "Ember spend failed; treating game as funded",
      { user_id: userId },
      error instanceof Error ? error : new Error(String(error))
    );
    return true;
  }
}

export default emberService;
