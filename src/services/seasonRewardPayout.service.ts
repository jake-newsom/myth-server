import db from "../config/db.config";
import SeasonModel from "../models/season.model";
import SeasonSoulsModel from "../models/seasonSouls.model";
import SeasonRewardTierModel, {
  SeasonRewardAxis,
  SeasonRewardBundle,
  SeasonRewardTierRow,
  resolveTierForRank,
  resolvePantheonTier,
} from "../models/seasonRewardTier.model";
import CardBackModel from "../models/cardBack.model";
import { QueryExecutor } from "../config/db.config";
import { MIN_SOULS_FOR_REWARDS } from "../config/constants";
import logger from "../utils/logger";

/**
 * Insert a reward mail row via a supplied (transactional) executor and return
 * its id. Mirrors MailModel.create's INSERT but participates in the caller's
 * transaction so mail + payout status commit together.
 */
async function insertRewardMail(
  exec: QueryExecutor,
  userId: string,
  reward: {
    subject: string;
    content: string;
    reward_gems?: number;
    reward_packs?: number;
    reward_card_ids?: string[];
    reward_border_id?: string | null;
  }
): Promise<string> {
  const { rows } = await exec.query(
    `INSERT INTO mail (
       user_id, mail_type, subject, content, sender_id, sender_name,
       has_rewards, reward_gold, reward_gems, reward_packs, reward_fate_coins,
       reward_card_ids, reward_border_id, expires_at
     )
     VALUES ($1, 'reward', $2, $3, NULL, 'Season Rewards',
             true, 0, $4, $5, 0, $6, $7, NULL)
     RETURNING id;`,
    [
      userId,
      reward.subject,
      reward.content,
      reward.reward_gems ?? 0,
      reward.reward_packs ?? 0,
      reward.reward_card_ids ?? [],
      reward.reward_border_id ?? null,
    ]
  );
  return rows[0].id as string;
}

/**
 * Season reward payouts.
 *
 * When a season's window closes, the maintenance scheduler flips it to
 * `finalizing`. This service assigns every ranked contributor to a reward tier
 * (by their per-set rank — the same ranking players see) and delivers the
 * tier's bundle:
 *
 *   - gems / packs / unique-art cards / a cosmetic border  -> via mail
 *     (one "reward" mail for currency+cards, plus one mail per extra border
 *      since a mail row carries a single border)
 *   - card backs -> granted directly (no mail/claim path exists for them)
 *
 * A `season_reward_payouts` row (UNIQUE per season+user) makes delivery
 * idempotent: a user already at status `sent`/`claimed` is skipped on re-runs,
 * so a crash mid-finalization can safely resume. Once all contributors are
 * processed the season is marked `finalized`.
 */

interface PayoutOutcome {
  paid: number;
  skipped: number;
  failed: number;
}

const SeasonRewardPayoutService = {
  /** Finalize every season currently in the `finalizing` state. */
  async processFinalizingSeasons(): Promise<void> {
    const seasons = await SeasonModel.getFinalizingSeasons();
    for (const season of seasons) {
      try {
        const outcome = await this.payoutSeason(season.season_id);
        logger.info("Season rewards paid out", {
          seasonId: season.season_id,
          ...outcome,
        });
        // Only finalize if nothing failed; otherwise leave `finalizing` so the
        // next scheduler tick retries the failed users (idempotently).
        if (outcome.failed === 0) {
          await SeasonModel.markFinalized(season.season_id);
        }
      } catch (error) {
        logger.error(
          "Season payout failed",
          { seasonId: season.season_id },
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }
  },

  /** Assign tiers and deliver rewards for a single season across both axes. */
  async payoutSeason(seasonId: string): Promise<PayoutOutcome> {
    const overall = await this.payoutOverallAxis(seasonId);
    const pantheon = await this.payoutPantheonAxis(seasonId);
    return {
      paid: overall.paid + pantheon.paid,
      skipped: overall.skipped + pantheon.skipped,
      failed: overall.failed + pantheon.failed,
    };
  },

  /**
   * Axis 1 — personal overall rank across all players. Honors the eligibility
   * floor (sub-threshold players aren't paid).
   */
  async payoutOverallAxis(seasonId: string): Promise<PayoutOutcome> {
    const tiers = await SeasonRewardTierModel.getTiersForSeason(
      seasonId,
      "overall"
    );
    if (tiers.length === 0) {
      logger.warn("No overall reward tiers for season", { seasonId });
      return { paid: 0, skipped: 0, failed: 0 };
    }

    const players = await SeasonSoulsModel.getAllRankedPlayersOverall(seasonId);
    const outcome: PayoutOutcome = { paid: 0, skipped: 0, failed: 0 };

    for (const p of players) {
      if (p.souls_total < MIN_SOULS_FOR_REWARDS) {
        outcome.skipped++;
        continue;
      }
      const tier = resolveTierForRank(tiers, p.rank, p.total_ranked);
      if (!tier) {
        outcome.skipped++;
        continue;
      }
      await this.tryDeliver(seasonId, p.user_id, "overall", tier, outcome);
    }
    return outcome;
  },

  /**
   * Axis 2 — the player's chosen pantheon's placement in the faction race.
   * Every member of a pantheon that placed within a tier shares that bundle,
   * regardless of personal rank (no eligibility floor on this team axis).
   */
  async payoutPantheonAxis(seasonId: string): Promise<PayoutOutcome> {
    const tiers = await SeasonRewardTierModel.getTiersForSeason(
      seasonId,
      "pantheon"
    );
    if (tiers.length === 0) {
      logger.warn("No pantheon reward tiers for season", { seasonId });
      return { paid: 0, skipped: 0, failed: 0 };
    }

    // Map each set to its faction-race placement.
    const standings = await SeasonSoulsModel.getSeasonStandings(seasonId);
    const placementBySet = new Map<string, number>(
      standings.map((s) => [s.set_id, s.placement])
    );

    const players = await SeasonSoulsModel.getAllRankedPlayersOverall(seasonId);
    const outcome: PayoutOutcome = { paid: 0, skipped: 0, failed: 0 };

    for (const p of players) {
      const placement = placementBySet.get(p.set_id);
      if (!placement) {
        outcome.skipped++;
        continue;
      }
      const tier = resolvePantheonTier(tiers, placement);
      if (!tier) {
        outcome.skipped++;
        continue;
      }
      await this.tryDeliver(seasonId, p.user_id, "pantheon", tier, outcome);
    }
    return outcome;
  },

  /** Deliver one axis bundle to a user, tallying the outcome. */
  async tryDeliver(
    seasonId: string,
    userId: string,
    axis: SeasonRewardAxis,
    tier: SeasonRewardTierRow,
    outcome: PayoutOutcome
  ): Promise<void> {
    try {
      const result = await this.deliverToUser(seasonId, userId, axis, tier);
      if (result === "delivered") outcome.paid++;
      else outcome.skipped++;
    } catch (error) {
      outcome.failed++;
      logger.error(
        "Season payout to user failed",
        { seasonId, userId, axis, tier: tier.tier_key },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  },

  /**
   * Deliver one tier's bundle to one user for one axis, idempotently. Returns
   * "delivered" when rewards were freshly granted, or "skipped" when the user
   * was already paid for this season+axis.
   */
  async deliverToUser(
    seasonId: string,
    userId: string,
    axis: SeasonRewardAxis,
    tier: SeasonRewardTierRow
  ): Promise<"delivered" | "skipped"> {
    const bundle = tier.bundle_json;
    const client = await db.getClient();
    try {
      await client.query("BEGIN");

      // Claim the payout slot, locking the row so concurrent runs can't
      // double-deliver. A fresh insert lands as `pending`; an existing row is
      // returned with its current status. Only `sent`/`claimed` means already
      // delivered — a leftover `pending` (e.g. a prior crash before COMMIT)
      // is resumed and re-delivered.
      const claim = await client.query(
        `INSERT INTO season_reward_payouts
           (season_id, user_id, axis, status, bundle_json)
         VALUES ($1, $2, $3, 'pending', $4::jsonb)
         ON CONFLICT (season_id, user_id, axis)
           DO UPDATE SET bundle_json = EXCLUDED.bundle_json, updated_at = NOW()
         RETURNING status;`,
        [seasonId, userId, axis, JSON.stringify(bundle)]
      );

      const status = claim.rows[0]?.status as string | undefined;
      if (status === "sent" || status === "claimed") {
        await client.query("ROLLBACK");
        return "skipped";
      }

      // Card backs have no mail/claim path — grant directly.
      for (const backId of bundle.card_back_ids) {
        await CardBackModel.grantToUser(userId, backId, client);
      }

      const expandedCardIds = [...bundle.card_variant_ids];
      const borders = [...bundle.border_ids];

      const axisLabel =
        axis === "pantheon" ? "Pantheon Reward" : "Season Rank Reward";
      const earnedLine =
        axis === "pantheon"
          ? `Your pantheon finished as ${tier.label}.`
          : `You finished the season as ${tier.label}.`;

      // Primary reward mail: currency + packs + cards + the first border.
      // Inserted via the transaction client so mail and the payout-status
      // update commit atomically (no orphaned mail on a failed COMMIT).
      const firstBorder = borders.shift() ?? null;
      const primaryMailId = await insertRewardMail(client, userId, {
        subject: `${axisLabel} — ${tier.label}`,
        content: `Congratulations! ${earnedLine} Claim your rewards below.`,
        reward_gems: bundle.gems,
        reward_packs: bundle.packs,
        reward_card_ids: expandedCardIds,
        reward_border_id: firstBorder,
      });

      // Any remaining cosmetics each need their own mail (one border per mail).
      for (const borderId of borders) {
        await insertRewardMail(client, userId, {
          subject: `${axisLabel} — cosmetic`,
          content: "An additional season cosmetic reward awaits.",
          reward_border_id: borderId,
        });
      }

      await client.query(
        `UPDATE season_reward_payouts
           SET status = 'sent', mail_id = $4, updated_at = NOW()
         WHERE season_id = $1 AND user_id = $2 AND axis = $3;`,
        [seasonId, userId, axis, primaryMailId]
      );

      await client.query("COMMIT");
      return "delivered";
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  },
};

export type { SeasonRewardBundle };
export default SeasonRewardPayoutService;
