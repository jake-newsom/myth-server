import { Request, Response, NextFunction } from "express";
import db from "../../config/db.config";
import RankedDraftSessionModel from "../../models/rankedDraftSession.model";
import RankedDraft, {
  RANKED_DRAFT_FLAG,
  toStatePayload,
} from "../../services/rankedDraft.service";
import RankedMatchmaking from "../../services/rankedMatchmaking.service";
import RankedDraftOrchestrator from "../../services/rankedDraftOrchestrator.service";
import FeatureFlagService from "../../services/featureFlag.service";
import LeaderboardModel from "../../models/leaderboard.model";
import { default as UserModel } from "../../models/user.model";
import { RANKED_DRAFT_CONFIG } from "../../config/constants";
import { SEASONAL_REWARD_TIERS } from "../../services/rankedDraftRewards.service";
import { PVP_MIN_GAMES_FOR_REWARDS } from "../../config/pvpRanks";

/**
 * REST surface for Ranked Draft.
 *
 * The draft itself is played over sockets; these endpoints cover joining and
 * leaving the queue, and the reconnect/state read that a fresh page load needs
 * before its socket is listening.
 *
 * Every route is behind the `ranked-draft-pvp` flag and 404s when it is off, so
 * the mode does not exist as far as any client can tell.
 */

async function requireFlag(userId: string, res: Response): Promise<boolean> {
  if (await FeatureFlagService.isEnabled(userId, RANKED_DRAFT_FLAG)) {
    return true;
  }
  res.status(404).json({ error: { message: "Not found." } });
  return false;
}

const RankedDraftController = {
  /** Join the ranked queue. No deck — that is the point of the mode. */
  async joinQueue(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user.user_id;
      if (!(await requireFlag(userId, res))) return;

      // A live draft or an unfinished ranked game must block a second queue.
      const live = await RankedDraftSessionModel.findLiveForUser(userId);
      if (live) {
        return res.status(409).json({
          error: {
            message: "You already have a draft in progress.",
            code: "DRAFT_IN_PROGRESS",
          },
          sessionId: live.session_id,
        });
      }

      const active = await db.query(
        `SELECT game_id FROM "games"
         WHERE (player1_id = $1 OR player2_id = $1)
           AND game_status IN ('active', 'mulligan')
           AND game_mode = 'ranked_draft'
         LIMIT 1`,
        [userId]
      );
      if (active.rows.length > 0) {
        return res.status(409).json({
          error: {
            message: "You already have a ranked game in progress.",
            code: "ACTIVE_GAME_EXISTS",
          },
          gameId: active.rows[0].game_id,
        });
      }

      // Daily cap. Checked AFTER the in-progress guards so a player mid-draft
      // is told about the draft, not the limit — and so the battle they are
      // already in cannot lock them out of finishing it.
      const usage = await RankedDraft.getDailyBattleUsage(userId);
      if (usage.remaining <= 0) {
        return res.status(429).json({
          error: {
            message: `You have used all ${usage.limit} ranked battles for today. More are available at midnight UTC.`,
            code: "DAILY_LIMIT_REACHED",
          },
          dailyBattles: usage,
        });
      }

      await RankedMatchmaking.joinQueue(userId);
      // Try to pair immediately so a waiting opponent is matched without
      // waiting for the next scheduler tick.
      await RankedMatchmaking.runMatchPass();

      const status = RankedMatchmaking.queueStatus(userId);
      if (!status) {
        // Already paired by the pass above.
        const session = await RankedDraftSessionModel.findLiveForUser(userId);
        return res.status(200).json({
          status: "matched",
          sessionId: session?.session_id ?? null,
        });
      }
      return res.status(202).json({
        status: "queued",
        waitTime: status.waitSeconds,
        queueLength: status.queueLength,
      });
    } catch (error) {
      next(error);
    }
  },

  async leaveQueue(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user.user_id;
      if (!(await requireFlag(userId, res))) return;
      const left = RankedMatchmaking.leaveQueue(userId);
      return res
        .status(left ? 200 : 400)
        .json(
          left
            ? { status: "left_queue" }
            : { error: { message: "You are not in the ranked queue." } }
        );
    } catch (error) {
      next(error);
    }
  },

  async getQueueStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user.user_id;
      if (!(await requireFlag(userId, res))) return;

      // Carried on every status reply so the client's counter re-syncs after a
      // battle (and across the midnight reset) without a second round trip.
      const dailyBattles = await RankedDraft.getDailyBattleUsage(userId);

      const session = await RankedDraftSessionModel.findLiveForUser(userId);
      if (session) {
        return res.status(200).json({
          status: "drafting",
          sessionId: session.session_id,
          dailyBattles,
        });
      }
      const status = RankedMatchmaking.queueStatus(userId);
      if (status) {
        return res.status(200).json({
          status: "queued",
          waitTime: status.waitSeconds,
          queueLength: status.queueLength,
          dailyBattles,
        });
      }
      return res.status(200).json({ status: "idle", dailyBattles });
    } catch (error) {
      next(error);
    }
  },

  /**
   * The caller's view of their live draft.
   *
   * Uses the same redacting projection as the socket path, so an unrevealed
   * opponent ban cannot be read out through HTTP either.
   */
  async getSession(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user.user_id;
      if (!(await requireFlag(userId, res))) return;

      const found = await RankedDraftSessionModel.findLiveForUser(userId);
      if (!found) {
        return res.status(404).json({ error: { message: "No active draft." } });
      }
      // Same self-heal as the socket path, so a plain page refresh also
      // unblocks a wedged draft.
      const session = await RankedDraftOrchestrator.reconcileSession(found);
      if (
        session.phase !== "ban" &&
        session.phase !== "draft" &&
        session.phase !== "block"
      ) {
        return res.status(404).json({ error: { message: "No active draft." } });
      }
      const opponentId =
        session.player1_id === userId ? session.player2_id : session.player1_id;
      const [opponent, recentCardIds] = await Promise.all([
        UserModel.findById(opponentId),
        RankedDraft.getRecentCards(userId),
      ]);
      const payload = await toStatePayload(session, userId, {
        opponentUsername: opponent?.username ?? "Opponent",
        recentCardIds,
      });
      return res.status(200).json(payload);
    } catch (error) {
      next(error);
    }
  },

  /**
   * Owned variants of a drafted card, for the skin picker.
   *
   * Always includes the original printing, so the response is never empty and
   * the client can show the picker unconditionally.
   */
  async getVariants(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user.user_id;
      if (!(await requireFlag(userId, res))) return;

      const cardVariantId = req.params.cardVariantId;
      if (!cardVariantId) {
        return res.status(400).json({ error: { message: "cardVariantId is required." } });
      }
      const variants = await RankedDraft.getOwnedVariantsForPick(
        userId,
        cardVariantId
      );
      return res.status(200).json({ variants });
    } catch (error) {
      next(error);
    }
  },

  /** Format info for the client (budget, pick count, clocks). */
  async getConfig(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user.user_id;
      if (!(await requireFlag(userId, res))) return;
      return res.status(200).json({
        picks: RANKED_DRAFT_CONFIG.PICKS,
        copiesPerPick: RANKED_DRAFT_CONFIG.COPIES_PER_PICK,
        powerBudget: RANKED_DRAFT_CONFIG.POWER_BUDGET,
        bansPerPlayer: RANKED_DRAFT_CONFIG.BANS_PER_PLAYER,
        banMs: RANKED_DRAFT_CONFIG.BAN_MS,
        pickMs: RANKED_DRAFT_CONFIG.PICK_MS,
        season: LeaderboardModel.getRankedDraftSeason(),
        // Additive: old clients ignore it, new clients render the counter.
        dailyBattles: await RankedDraft.getDailyBattleUsage(userId),
        // Served rather than hardcoded client-side: the client's copy had
        // already drifted from these bands, showing ladder positions for
        // payouts that are keyed to ranks.
        seasonRewardTiers: SEASONAL_REWARD_TIERS.map((t) => ({
          rankKey: t.rankKey,
          label: t.label,
          gems: t.gems,
          packs: t.packs,
        })),
        minGamesForRewards: PVP_MIN_GAMES_FOR_REWARDS,
      });
    } catch (error) {
      next(error);
    }
  },
};

export default RankedDraftController;
