import db, { QueryExecutor } from "../config/db.config";
import LeaderboardModel from "../models/leaderboard.model";
import FeatureFlagService from "./featureFlag.service";
import { RANKED_DRAFT_REWARDS_FLAG } from "./rankedDraft.service";
import {
  PVP_MIN_GAMES_FOR_REWARDS,
  resolveRank,
  IMMORTAL_FLOOR,
  softResetRating,
} from "../config/pvpRanks";
import logger from "../utils/logger";

/**
 * Seasonal rewards for the Ranked Draft ladder.
 *
 * The ladder pays out ONCE per season, on the same quarterly schedule as the
 * Season Souls payout: SeasonService's maintenance tick flips a season to
 * `finalizing`, and SeasonRewardPayoutService calls in here as part of that
 * same pass. There is no weekly payout — a weekly cadence paid out a ladder
 * that was only days old right after a season rollover, and split the "season
 * ended" moment across two unrelated schedules.
 *
 * Delivery reuses the existing reward-mail mechanism (the same `mail` rows the
 * season payout service writes), so nothing new is needed on the client to
 * claim these.
 *
 * Idempotency is the whole design: the job reads a leaderboard and sends mail,
 * so a crash halfway through must be safe to retry. The unique
 * (season_key, user_id) row is claimed BEFORE the mail is sent, mirroring the
 * game_rewards_granted gate in gameRewards.service.
 */

export interface SeasonalRewardTier {
  /** The PVP_RANKS key this band pays. */
  rankKey: string;
  label: string;
  gems: number;
  packs: number;
}

/**
 * Payout bands, one per rank.
 *
 * Keyed to the RANK a player finished at, not their ladder position. Position
 * bands ("ranks 11-50") were meaningless on a small ladder — they paid a
 * mid-table player a top prize simply because nobody else had queued — and
 * their labels had already drifted from the real rank names.
 *
 * Rank already encodes standing: the positional ranks at the top ARE ladder
 * position (Zenith is #1, Worldforger the top 3, Titan the top tenth), while
 * the earned ranks below them are rating bands that mean the same thing however
 * many people played.
 *
 * Anyone who cleared the games floor but holds no listed rank still gets the
 * lowest band, so the ladder always pays something for turning up.
 */
export const SEASONAL_REWARD_TIERS: SeasonalRewardTier[] = [
  { rankKey: "zenith", label: "Zenith", gems: 6000, packs: 30 },
  { rankKey: "worldforger", label: "Worldforger", gems: 3500, packs: 20 },
  { rankKey: "titan", label: "Titan", gems: 1800, packs: 12 },
  { rankKey: "immortal", label: "Immortal", gems: 900, packs: 6 },
  { rankKey: "ascendant", label: "Ascendant", gems: 500, packs: 4 },
  { rankKey: "chosen", label: "Chosen", gems: 300, packs: 2 },
  { rankKey: "champion", label: "Champion", gems: 150, packs: 1 },
  { rankKey: "seeker", label: "Seeker", gems: 75, packs: 1 },
];

/** The band a finishing rank pays, or null when the rank is unlisted. */
export function tierForRankKey(rankKey: string): SeasonalRewardTier | null {
  return SEASONAL_REWARD_TIERS.find((t) => t.rankKey === rankKey) ?? null;
}

/**
 * How far down the ladder the payout job reads.
 *
 * Still bounded — the job sends mail per row, so an unbounded read is a
 * runaway — but every rank is payable now, so this is a safety limit rather
 * than a reward cutoff.
 */
const MAX_REWARDED_PLAYERS = 5000;

async function insertRewardMail(
  exec: QueryExecutor,
  userId: string,
  reward: {
    subject: string;
    content: string;
    gems: number;
    packs: number;
  }
): Promise<string> {
  const { rows } = await exec.query(
    `INSERT INTO mail (
       user_id, mail_type, subject, content, sender_id, sender_name,
       has_rewards, reward_gold, reward_gems, reward_packs, reward_fate_coins,
       expires_at
     )
     VALUES ($1, 'reward', $2, $3, NULL, 'Ranked Rewards',
             true, 0, $4, $5, 0, NULL)
     RETURNING id;`,
    [userId, reward.subject, reward.content, reward.gems, reward.packs]
  );
  return rows[0].id;
}

export interface SeasonalPayoutResult {
  /** The season_definitions row this payout belongs to. */
  seasonId: string;
  /** The user_rankings ladder key that was read. */
  season: string;
  paid: number;
  skipped: number;
}

/**
 * Pays out one season of the ranked ladder.
 *
 * Safe to call repeatedly: players already paid for `seasonId` are skipped by
 * the unique constraint rather than double-rewarded.
 */
export async function runSeasonalPayout(
  seasonId: string,
  options: { season?: string } = {}
): Promise<SeasonalPayoutResult> {
  const season = options.season ?? LeaderboardModel.getRankedDraftSeason();

  const result: SeasonalPayoutResult = { seasonId, season, paid: 0, skipped: 0 };

  // Read the ladder. Rank comes from rating order, matching how the
  // leaderboard view presents it. Only players who met the games-played floor
  // are considered, so a single lucky win cannot land a payout.
  const { rows: standings } = await db.query(
    `SELECT user_id, rating, last_game_at,
            ROW_NUMBER() OVER (ORDER BY rating DESC, updated_at ASC) AS rank_position
     FROM user_rankings
     WHERE season = $1 AND (wins + losses + draws) >= $2
     ORDER BY rating DESC
     LIMIT $3`,
    [season, PVP_MIN_GAMES_FOR_REWARDS, MAX_REWARDED_PLAYERS]
  );

  // Pool for the proportional positional ranks. Counted from the standings
  // already in hand rather than re-queried — these rows ARE the ladder.
  const positionalPool = standings.filter(
    (r: { rating: number }) => r.rating >= IMMORTAL_FLOOR
  ).length;

  for (const row of standings) {
    const rank = Number(row.rank_position);

    // The rank the player actually finished with — this is what decides the
    // payout, so it is resolved BEFORE the tier rather than only for flavour.
    const finalRank = resolveRank({
      rating: row.rating,
      rankPosition: rank,
      lastGameAt: row.last_game_at,
      poolSize: positionalPool,
    });

    const tier = tierForRankKey(finalRank.rank.key);
    if (!tier) continue;

    const client = await db.getClient();
    try {
      await client.query("BEGIN");

      // Claim the slot FIRST. If this conflicts, someone already paid them.
      const claim = await client.query(
        `INSERT INTO ranked_draft_season_payouts
           (season_id, user_id, season, rank_position, rating, tier_label,
            rank_key, reward_gems, reward_packs)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (season_id, user_id) DO NOTHING
         RETURNING id`,
        [
          seasonId, row.user_id, season, rank, row.rating,
          tier.label, finalRank.rank.key, tier.gems, tier.packs,
        ]
      );

      if (claim.rowCount === 0) {
        await client.query("ROLLBACK");
        result.skipped++;
        continue;
      }

      const mailId = await insertRewardMail(client, row.user_id, {
        subject: `Ranked Draft — ${tier.label}`,
        content:
          `The season has ended. You finished as ${finalRank.label} ` +
          `at rank #${rank}, with a rating of ${row.rating}. ` +
          `Claim your rewards below.`,
        gems: tier.gems,
        packs: tier.packs,
      });

      await client.query(
        `UPDATE ranked_draft_season_payouts SET mail_id = $2 WHERE id = $1`,
        [claim.rows[0].id, mailId]
      );

      await client.query("COMMIT");
      result.paid++;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      // One player's failure must not abort the whole ladder's payout.
      logger.error("[rankedDraftRewards] seasonal payout failed for user", {
        userId: row.user_id,
        seasonId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      client.release();
    }
  }

  logger.info("[rankedDraftRewards] seasonal payout complete", result);
  return result;
}

/**
 * Carry ratings into the next season instead of wiping them.
 *
 * Ratings are keyed by season string, so a new season already starts every
 * player from the default. That is a hard reset: a whole season of climbing
 * vanishes overnight. This seeds the NEXT season's rows from the finished
 * one's, compressed toward the base rating, so standings still reshuffle but
 * progress is not erased.
 *
 * Idempotent: rows are only inserted where none exists, so a player who has
 * already played a game in the new season keeps their real rating.
 */
export async function applySoftReset(
  finishedSeason: string,
  nextSeason: string
): Promise<{ carried: number }> {
  const { rows } = await db.query(
    `SELECT user_id, rating FROM user_rankings
     WHERE season = $1 AND (wins + losses + draws) > 0`,
    [finishedSeason]
  );

  let carried = 0;
  for (const row of rows) {
    const seeded = softResetRating(Number(row.rating));
    const { rowCount } = await db.query(
      `INSERT INTO user_rankings (user_id, season, rating)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, season) DO NOTHING`,
      [row.user_id, nextSeason, seeded]
    );
    if (rowCount) carried++;
  }

  logger.info("[rankedDraftRewards] soft reset applied", {
    finishedSeason,
    nextSeason,
    carried,
  });
  return { carried };
}

/**
 * Entry point used by the season finalizer. Gated so the payout can be killed
 * without taking the mode itself offline.
 *
 * The flag is checked globally (not per-user) because a payout run is a
 * ladder-wide operation, not a per-player feature.
 */
export async function runSeasonalPayoutIfEnabled(
  seasonId: string,
  options: { season?: string } = {}
): Promise<SeasonalPayoutResult | null> {
  // A payout run is ladder-wide, so it reads the global switch rather than
  // any single user's override. A lookup failure resolves to "off" — never pay
  // out on an error.
  const flag = await FeatureFlagService.getFlagByKey(
    RANKED_DRAFT_REWARDS_FLAG
  ).catch(() => null);
  if (!flag?.enabled_globally) return null;
  return runSeasonalPayout(seasonId, options);
}

export default {
  SEASONAL_REWARD_TIERS,
  tierForRankKey,
  runSeasonalPayout,
  runSeasonalPayoutIfEnabled,
  applySoftReset,
};
