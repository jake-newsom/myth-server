import { cosmeticRewardsToItems } from "../utils/rewards.helpers";
// myth-server/src/services/loginSequence.service.ts

import db, { QueryExecutor } from "../config/db.config";
import RewardService from "./reward.service";
import EventService from "./event.service";
import logger from "../utils/logger";
import { RewardItem } from "../types/service.types";
import {
  LoginSequence,
  LoginSequenceReward,
  LoginSequenceStatus,
} from "../types/event.types";

/**
 * Login Sequence Service
 *
 * A reusable, standalone sequenced-login-reward system: a named window
 * (start/end) plus an ordered ladder of rewards. Events reference a sequence
 * by id rather than owning one, so the same ladder can be reused, cloned, or
 * run entirely outside an event.
 *
 * ## Why "login count" and not "calendar day"
 *
 * A rung is the Nth day the player logged in during the window, not the Nth
 * day of the window. Missing a day costs a player progress but never
 * *forfeits* a rung, which is the behavior players expect from this kind of
 * ladder and avoids the "logged in 6 of 7 days, got nothing" outcome.
 *
 * ## Idempotence
 *
 * Crediting is keyed on `last_credited_date` (a UTC date). Calling
 * `creditLogin` many times in a day advances the ladder exactly once; the
 * partial unique behavior is enforced by comparing against that column inside
 * the same UPDATE, so concurrent logins cannot double-credit.
 */

/** Current UTC date as YYYY-MM-DD, matching the rest of the codebase's
 * treatment of daily boundaries (see MonthlyLoginRewardsService). */
function currentUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function rowToReward(row: any): LoginSequenceReward {
  return {
    id: row.id,
    sequence_id: row.sequence_id,
    day_index: row.day_index,
    reward_gold: row.reward_gold,
    reward_gems: row.reward_gems,
    reward_fate_coins: row.reward_fate_coins,
    reward_card_fragments: row.reward_card_fragments,
    reward_packs: row.reward_packs,
    reward_embers: row.reward_embers,
    reward_event_currency: row.reward_event_currency,
    reward_card_variant_id: row.reward_card_variant_id,
    reward_border_id: row.reward_border_id,
    reward_card_back_id: row.reward_card_back_id,
    reward_title_id: row.reward_title_id ?? null,
    reward_frame_id: row.reward_frame_id ?? null,
    is_milestone: row.is_milestone,
  };
}

/** Map a ladder rung's reward columns onto the shared RewardItem vocabulary.
 * Event currency is intentionally excluded — it is not a RewardService type
 * and is granted separately through the event ledger. */
function rungToRewardItems(reward: LoginSequenceReward): RewardItem[] {
  const items: RewardItem[] = [];
  if (reward.reward_gems > 0) items.push({ type: "gems", amount: reward.reward_gems });
  if (reward.reward_gold > 0) items.push({ type: "gold", amount: reward.reward_gold });
  if (reward.reward_fate_coins > 0)
    items.push({ type: "fate_coins", amount: reward.reward_fate_coins });
  if (reward.reward_card_fragments > 0)
    items.push({ type: "card_fragments", amount: reward.reward_card_fragments });
  if (reward.reward_packs > 0) items.push({ type: "packs", amount: reward.reward_packs });
  if (reward.reward_embers > 0) items.push({ type: "embers", amount: reward.reward_embers });
  if (reward.reward_card_variant_id)
    items.push({ type: "card", card_variant_id: reward.reward_card_variant_id });
  if (reward.reward_border_id)
    items.push({ type: "border", border_id: reward.reward_border_id });
  if (reward.reward_card_back_id)
    items.push({ type: "card_back", back_id: reward.reward_card_back_id });
  items.push(...cosmeticRewardsToItems(reward));
  return items;
}

const LoginSequenceService = {
  async getSequenceById(
    sequenceId: string,
    executor: QueryExecutor = db
  ): Promise<LoginSequence | null> {
    const result = await executor.query(
      `SELECT id, sequence_key, name, description, starts_at, ends_at, is_active
         FROM login_sequences WHERE id = $1`,
      [sequenceId]
    );
    return result.rows[0] ?? null;
  },

  async getSequenceByKey(sequenceKey: string): Promise<LoginSequence | null> {
    const result = await db.query(
      `SELECT id, sequence_key, name, description, starts_at, ends_at, is_active
         FROM login_sequences WHERE sequence_key = $1`,
      [sequenceKey]
    );
    return result.rows[0] ?? null;
  },

  async getRewards(
    sequenceId: string,
    executor: QueryExecutor = db
  ): Promise<LoginSequenceReward[]> {
    const result = await executor.query(
      `SELECT * FROM login_sequence_rewards
        WHERE sequence_id = $1 ORDER BY day_index ASC`,
      [sequenceId]
    );
    return result.rows.map(rowToReward);
  },

  /** True when the sequence window contains now(). */
  isWindowOpen(sequence: LoginSequence): boolean {
    const now = Date.now();
    return (
      sequence.is_active &&
      now >= new Date(sequence.starts_at).getTime() &&
      now < new Date(sequence.ends_at).getTime()
    );
  },

  /**
   * Advance the user's ladder by one rung if they have not already been
   * credited today and the window is open. Safe to call on every login /
   * session start; it is a no-op the rest of the day.
   *
   * Never throws — a failure here must not block login.
   */
  async creditLogin(userId: string, sequenceId: string): Promise<boolean> {
    try {
      const sequence = await this.getSequenceById(sequenceId);
      if (!sequence || !this.isWindowOpen(sequence)) return false;

      const today = currentUtcDate();

      // The WHERE clause is the idempotence guard: a row already credited
      // today matches nothing, so a concurrent second call credits zero rows.
      const result = await db.query(
        `INSERT INTO user_login_sequence_progress
           (user_id, sequence_id, days_credited, days_claimed, last_credited_date)
         VALUES ($1, $2, 1, 0, $3::date)
         ON CONFLICT (user_id, sequence_id) DO UPDATE
           SET days_credited = user_login_sequence_progress.days_credited + 1,
               last_credited_date = EXCLUDED.last_credited_date,
               updated_at = now()
           WHERE user_login_sequence_progress.last_credited_date IS DISTINCT FROM $3::date
         RETURNING days_credited`,
        [userId, sequenceId, today]
      );

      return result.rows.length > 0;
    } catch (error) {
      logger.error(
        "Login sequence credit failed",
        { userId, sequenceId },
        error instanceof Error ? error : new Error(String(error))
      );
      return false;
    }
  },

  async getProgress(userId: string, sequenceId: string, executor: QueryExecutor = db) {
    const result = await executor.query(
      `SELECT days_credited, days_claimed, last_credited_date
         FROM user_login_sequence_progress
        WHERE user_id = $1 AND sequence_id = $2`,
      [userId, sequenceId]
    );
    return (
      result.rows[0] ?? { days_credited: 0, days_claimed: 0, last_credited_date: null }
    );
  },

  /** Full ladder + progress for display. */
  async getStatus(
    userId: string,
    sequenceId: string
  ): Promise<LoginSequenceStatus | null> {
    const sequence = await this.getSequenceById(sequenceId);
    if (!sequence) return null;

    const [rewards, progress] = await Promise.all([
      this.getRewards(sequenceId),
      this.getProgress(userId, sequenceId),
    ]);

    const today = currentUtcDate();
    const lastCredited = progress.last_credited_date
      ? new Date(progress.last_credited_date).toISOString().slice(0, 10)
      : null;

    return {
      sequence: {
        id: sequence.id,
        sequence_key: sequence.sequence_key,
        name: sequence.name,
        description: sequence.description,
        starts_at: new Date(sequence.starts_at).toISOString(),
        ends_at: new Date(sequence.ends_at).toISOString(),
      },
      days_credited: progress.days_credited,
      days_claimed: progress.days_claimed,
      can_claim: progress.days_claimed < progress.days_credited,
      credited_today: lastCredited === today,
      rewards: rewards.map((r) => ({
        ...r,
        claimed: r.day_index <= progress.days_claimed,
        unlocked: r.day_index <= progress.days_credited,
      })),
    };
  },

  /**
   * Claim every credited-but-unclaimed rung in one transaction.
   *
   * Claiming all pending rungs at once (rather than one call per rung) keeps
   * the client simple and means a player who returns after several days gets
   * a single receipt. `eventCurrencyId` is supplied by the caller because a
   * sequence is event-agnostic: the same ladder pays a different currency
   * depending on which event references it.
   */
  async claimPending(
    userId: string,
    sequenceId: string,
    eventCurrencyId: string | null = null
  ): Promise<{
    success: boolean;
    claimed_days: number[];
    items: RewardItem[];
    event_currency_granted: number;
    error?: string;
  }> {
    const client = await db.getClient();
    try {
      await client.query("BEGIN");

      // Lock the progress row so two concurrent claims cannot both read the
      // same days_claimed and grant the same rungs twice.
      const progressResult = await client.query(
        `SELECT days_credited, days_claimed
           FROM user_login_sequence_progress
          WHERE user_id = $1 AND sequence_id = $2
          FOR UPDATE`,
        [userId, sequenceId]
      );

      const progress = progressResult.rows[0];
      if (!progress || progress.days_claimed >= progress.days_credited) {
        await client.query("ROLLBACK");
        return {
          success: false,
          claimed_days: [],
          items: [],
          event_currency_granted: 0,
          error: "Nothing to claim",
        };
      }

      const rewards = await this.getRewards(sequenceId, client);
      const pending = rewards.filter(
        (r) =>
          r.day_index > progress.days_claimed &&
          r.day_index <= progress.days_credited
      );

      const items: RewardItem[] = [];
      let eventCurrency = 0;
      for (const rung of pending) {
        items.push(...rungToRewardItems(rung));
        eventCurrency += rung.reward_event_currency;
      }

      if (items.length > 0) {
        await RewardService.grantRewards(userId, items, { client });
      }
      if (eventCurrency > 0 && eventCurrencyId) {
        await EventService.grantCurrency(
          userId,
          eventCurrencyId,
          eventCurrency,
          client
        );
      }

      await client.query(
        `UPDATE user_login_sequence_progress
            SET days_claimed = days_credited, updated_at = now()
          WHERE user_id = $1 AND sequence_id = $2`,
        [userId, sequenceId]
      );

      await client.query("COMMIT");
      return {
        success: true,
        claimed_days: pending.map((r) => r.day_index),
        items,
        event_currency_granted: eventCurrencyId ? eventCurrency : 0,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      logger.error(
        "Login sequence claim failed",
        { userId, sequenceId },
        error instanceof Error ? error : new Error(String(error))
      );
      return {
        success: false,
        claimed_days: [],
        items: [],
        event_currency_granted: 0,
        error: "Claim failed",
      };
    } finally {
      client.release();
    }
  },
};

export default LoginSequenceService;
