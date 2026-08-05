import db, { PoolClient } from "../config/db.config";
import MailModel from "../models/mail.model";
import CardBackModel from "../models/cardBack.model";
import logger from "../utils/logger";
import { pickWeightedVariantByRarity } from "../utils/cardVariant.helpers";
import {
  ONBOARDING_CUTOFF_UTC,
  ONBOARDING_FINAL_DAY,
  ONBOARDING_LEGENDARY_WEIGHTS,
  ONBOARDING_MILESTONES,
  OnboardingMilestone,
  isWithinOnboardingCutoff,
  milestonesUpTo,
} from "../config/onboarding.config";

/**
 * Launch onboarding reward track.
 *
 * `current_day` is the Nth DISTINCT UTC day the player made an authenticated
 * request (day 1 = signup day). It only ever increments, at most once per UTC
 * day, so missing a day pauses the track rather than resetting it.
 *
 * `tick()` runs fire-and-forget from auth.middleware.protect on every
 * authenticated request, so it is written to be cheap and to never throw:
 *
 *   1. Cutoff check      -- zero DB, from req.user.created_at
 *   2. In-process memo   -- zero DB when we already ticked this user today
 *   3. Conditional UPDATE -- one statement that reads, writes, and
 *                            short-circuits atomically
 *
 * Duplicate mail is prevented by UNIQUE(user_id, milestone_day) on
 * user_onboarding_grants, not by any of the above -- the memo is a cache, not
 * a correctness mechanism (it is per-process, so N instances each dedupe
 * independently).
 */

/** userId -> UTC date string (YYYY-MM-DD) we last ticked them on. */
const tickMemo = new Map<string, string>();
/** Users whose track is complete; they never need another statement. */
const completedMemo = new Set<string>();

/** Bound memory on large user bases; the SQL remains the source of truth. */
const TICK_MEMO_MAX = 50_000;

function utcDateString(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function rememberTick(userId: string, day: string): void {
  if (tickMemo.size >= TICK_MEMO_MAX) {
    // Cheapest correct eviction: drop everything. Worst case the next request
    // for each user costs one conditional UPDATE that returns zero rows.
    tickMemo.clear();
  }
  tickMemo.set(userId, day);
}

export interface OnboardingMilestoneStatus {
  day: number;
  display: OnboardingMilestone["display"];
  state: "locked" | "unclaimed" | "claimed";
  mail_id: string | null;
  granted_at: string | null;
}

export interface OnboardingStatusResponse {
  success: boolean;
  eligible: boolean;
  cutoff: string;
  current_day: number;
  completed: boolean;
  milestones: OnboardingMilestoneStatus[];
}

const OnboardingService = {
  /** A user is eligible for the track only if they registered pre-cutoff. */
  isEligible(createdAt: Date | string): boolean {
    return isWithinOnboardingCutoff(createdAt);
  },

  /**
   * Seed the progress row and dispatch the day-1 welcome mail. Called at
   * registration, alongside StarterService.grantStarterContent.
   */
  async initializeForUser(userId: string, createdAt: Date): Promise<void> {
    if (!this.isEligible(createdAt)) return;

    try {
      await db.query(
        `INSERT INTO user_onboarding_progress (user_id, current_day, last_tick_date)
         VALUES ($1, 1, (now() AT TIME ZONE 'utc')::date)
         ON CONFLICT (user_id) DO NOTHING;`,
        [userId]
      );
      rememberTick(userId, utcDateString());
      await this.dispatchMilestonesUpTo(userId, 1);
    } catch (error) {
      // Registration must never fail because of the onboarding track.
      logger.error(
        "OnboardingService.initializeForUser failed",
        { userId },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  },

  /**
   * Advance the day counter at most once per UTC day and dispatch anything
   * newly owed. Fire-and-forget: never throws, never blocks a response.
   */
  async tick(user: { user_id: string; created_at: Date }): Promise<void> {
    const userId = user.user_id;

    try {
      if (!this.isEligible(user.created_at)) return;
      if (completedMemo.has(userId)) return;

      const today = utcDateString();
      if (tickMemo.get(userId) === today) return;

      // One statement: advances only if the row exists, the track is
      // incomplete, and we have not already ticked today.
      const { rows } = await db.query(
        `UPDATE user_onboarding_progress
            SET current_day = current_day + 1,
                last_tick_date = (now() AT TIME ZONE 'utc')::date,
                updated_at = now()
          WHERE user_id = $1
            AND completed_at IS NULL
            AND last_tick_date < (now() AT TIME ZONE 'utc')::date
        RETURNING current_day;`,
        [userId]
      );

      // Memoize regardless of outcome: zero rows means "already ticked today"
      // or "track complete", both of which are no-ops for the rest of the day.
      rememberTick(userId, today);

      if (rows.length === 0) return;

      const currentDay = Number(rows[0].current_day);
      await this.dispatchMilestonesUpTo(userId, currentDay);
    } catch (error) {
      // Silent failure would make a broken rollout invisible, so log loudly.
      logger.error(
        "OnboardingService.tick failed",
        { userId },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  },

  /**
   * Send every milestone at or below `day` that has not already been granted.
   * A player returning after a long absence receives all owed mail at once.
   */
  async dispatchMilestonesUpTo(userId: string, day: number): Promise<void> {
    const owed = milestonesUpTo(day);
    if (owed.length === 0) return;

    // Pure optimization -- it just avoids pointless insert attempts. The
    // unique constraint in sendMilestoneMail is the real guard.
    const { rows } = await db.query(
      `SELECT milestone_day FROM user_onboarding_grants WHERE user_id = $1;`,
      [userId]
    );
    const alreadyGranted = new Set<number>(
      rows.map((r: { milestone_day: number }) => Number(r.milestone_day))
    );

    for (const milestone of owed) {
      if (alreadyGranted.has(milestone.day)) continue;
      await this.sendMilestoneMail(userId, milestone);
    }

    // Mark the track complete so future ticks short-circuit entirely.
    if (day >= ONBOARDING_FINAL_DAY) {
      await db.query(
        `UPDATE user_onboarding_progress
            SET completed_at = now(), updated_at = now()
          WHERE user_id = $1 AND completed_at IS NULL;`,
        [userId]
      );
      completedMemo.add(userId);
    }
  },

  /**
   * Ledger-guarded milestone send. Returns true if this call is the one that
   * sent the mail.
   *
   * The ledger insert and the mail insert share a transaction: if mail
   * creation fails after the ledger row is written, the rollback lets the next
   * request retry rather than losing the milestone permanently.
   */
  async sendMilestoneMail(
    userId: string,
    milestone: OnboardingMilestone
  ): Promise<boolean> {
    const client: PoolClient = await db.getClient();

    try {
      await client.query("BEGIN");

      const { rows } = await client.query(
        `INSERT INTO user_onboarding_grants (user_id, milestone_day)
         VALUES ($1, $2)
         ON CONFLICT (user_id, milestone_day) DO NOTHING
         RETURNING grant_id;`,
        [userId, milestone.day]
      );

      if (rows.length === 0) {
        // Another concurrent request already sent this milestone.
        await client.query("ROLLBACK");
        return false;
      }

      const grantId = rows[0].grant_id;

      // Roll the day-7 legendary at SEND time and store the variant id on the
      // mail. Mail rewards are only converted to grants at claim time, so
      // granting here would leave the mail empty and the claim worthless.
      const rewardCardIds: string[] = [];
      if (milestone.randomLegendaryFullArt) {
        const picked = await pickWeightedVariantByRarity(
          ONBOARDING_LEGENDARY_WEIGHTS,
          client
        );
        if (picked) {
          rewardCardIds.push(picked.card_variant_id);
        } else {
          // Still send the mail with its remaining rewards rather than
          // throwing away the milestone, but make the empty pool obvious.
          logger.error("Onboarding day-7 legendary pool is empty", {
            userId,
            weights: ONBOARDING_LEGENDARY_WEIGHTS,
          });
        }
      }

      let rewardCardBackId: string | null = null;
      if (milestone.cardBackCodeKey) {
        const back = await CardBackModel.findByCodeKey(
          milestone.cardBackCodeKey
        );
        if (back) {
          rewardCardBackId = back.back_id;
        } else {
          logger.error("Onboarding card back not found by code_key", {
            userId,
            codeKey: milestone.cardBackCodeKey,
          });
        }
      }

      const packs = milestone.packs ?? 0;
      const hasRewards =
        packs > 0 || rewardCardIds.length > 0 || rewardCardBackId !== null;

      const mail = await MailModel.create(
        {
          user_id: userId,
          mail_type: milestone.mailType,
          subject: milestone.subject,
          content: milestone.content,
          has_rewards: hasRewards,
          reward_packs: packs,
          reward_card_ids: rewardCardIds,
          reward_card_back_id: rewardCardBackId,
        },
        client
      );

      await client.query(
        `UPDATE user_onboarding_grants SET mail_id = $1 WHERE grant_id = $2;`,
        [mail.id, grantId]
      );

      await client.query("COMMIT");

      logger.info("Onboarding milestone dispatched", {
        userId,
        day: milestone.day,
        mailId: mail.id,
        packs,
        cardVariantIds: rewardCardIds,
        cardBackId: rewardCardBackId,
      });

      return true;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      logger.error(
        "OnboardingService.sendMilestoneMail failed",
        { userId, day: milestone.day },
        error instanceof Error ? error : new Error(String(error))
      );
      return false;
    } finally {
      client.release();
    }
  },

  /**
   * Per-milestone status for the client panel. Reads only the ledger, the
   * progress row, and config, so it is correct from the moment the server
   * ships -- ahead of the client patch that consumes it.
   */
  async getStatus(
    userId: string,
    createdAt: Date
  ): Promise<OnboardingStatusResponse> {
    const eligible = this.isEligible(createdAt);
    const cutoff = ONBOARDING_CUTOFF_UTC.toISOString();

    if (!eligible) {
      return {
        success: true,
        eligible: false,
        cutoff,
        current_day: 0,
        completed: false,
        milestones: ONBOARDING_MILESTONES.map((m) => ({
          day: m.day,
          display: m.display,
          state: "locked" as const,
          mail_id: null,
          granted_at: null,
        })),
      };
    }

    // Lazy seed for users who registered between the backfill and this
    // deploy. Safe here because getStatus is off the per-request hot path.
    await db.query(
      `INSERT INTO user_onboarding_progress (user_id, current_day, last_tick_date)
       VALUES ($1, 1, (now() AT TIME ZONE 'utc')::date)
       ON CONFLICT (user_id) DO NOTHING;`,
      [userId]
    );

    const { rows: progressRows } = await db.query(
      `SELECT current_day, completed_at
         FROM user_onboarding_progress
        WHERE user_id = $1;`,
      [userId]
    );

    const currentDay = Number(progressRows[0]?.current_day ?? 0);
    const completed = Boolean(progressRows[0]?.completed_at);

    const { rows: grantRows } = await db.query(
      `SELECT g.milestone_day, g.mail_id, g.granted_at, m.is_claimed
         FROM user_onboarding_grants g
         LEFT JOIN mail m ON m.id = g.mail_id
        WHERE g.user_id = $1;`,
      [userId]
    );

    const grantsByDay = new Map<
      number,
      { mail_id: string | null; granted_at: Date; is_claimed: boolean | null }
    >();
    for (const row of grantRows) {
      grantsByDay.set(Number(row.milestone_day), {
        mail_id: row.mail_id ?? null,
        granted_at: row.granted_at,
        is_claimed: row.is_claimed,
      });
    }

    const milestones: OnboardingMilestoneStatus[] = ONBOARDING_MILESTONES.map(
      (m) => {
        const grant = grantsByDay.get(m.day);
        if (!grant) {
          return {
            day: m.day,
            display: m.display,
            state: "locked" as const,
            mail_id: null,
            granted_at: null,
          };
        }

        // A deleted mail (mail_id NULL after ON DELETE SET NULL) counts as
        // claimed -- the reward left our hands and the row is gone.
        const state =
          grant.mail_id === null || grant.is_claimed ? "claimed" : "unclaimed";

        return {
          day: m.day,
          display: m.display,
          state: state as "claimed" | "unclaimed",
          mail_id: grant.mail_id,
          granted_at:
            grant.granted_at instanceof Date
              ? grant.granted_at.toISOString()
              : String(grant.granted_at),
        };
      }
    );

    return {
      success: true,
      eligible: true,
      cutoff,
      current_day: currentDay,
      completed,
      milestones,
    };
  },
};

export default OnboardingService;
