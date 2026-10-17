import fs from "fs";
import path from "path";
import db from "../config/db.config";
import {
  AI_CONFIG,
  RANKED_DRAFT_CONFIG,
  RARITY_POWER_COST,
} from "../config/constants";
import RankedDraftSessionModel, {
  RankedDraftSession,
} from "../models/rankedDraftSession.model";
import LeaderboardModel from "../models/leaderboard.model";
import { GameState } from "../types/game.types";
import { GameStatus } from "../types";
import { BaseGameEvent, sumAnimationDelay } from "../game-engine/game-events";
import { buildDraftGameState } from "./draftBattle.service";
import {
  applyPlayerMulligan,
  chooseAIMulligan,
} from "../game-engine/game.mulligan";
import { spendEmberForGame } from "./ember.service";
import {
  DraftBotView,
  DraftPoolCard,
  DraftValueTable,
  chooseBotBan,
  chooseBotBlock,
  chooseBotPick,
  LIVE_LOOSENESS,
  strengthForRating,
} from "../game-engine/draft/draftBot";
import { ORIGINAL_RARITY_SQL, unavailableCardIds } from "./rankedDraft.service";
import logger from "../utils/logger";

/**
 * Glue between a live Ranked Draft session and the practice bot.
 *
 * The bot is the existing AI user (AI_CONFIG.PLAYER_ID) sitting in player2.
 * Its decisions come from the pure draftBot module; everything here is
 * loading what that module needs and turning a finished bot draft into a
 * solo game.
 */

export const BOT_USER_ID = AI_CONFIG.PLAYER_ID;

export function isBotUser(userId: string | null | undefined): boolean {
  return userId === BOT_USER_ID;
}

const VALUE_TABLE_PATH = path.join(
  __dirname,
  "../../content/ai/draft-card-values.json"
);

let valueTable: DraftValueTable | null | undefined;

/** Learned card values; null (stat fallback) if the file is missing or bad. */
export function getValueTable(): DraftValueTable | null {
  if (valueTable !== undefined) return valueTable;
  try {
    const parsed = JSON.parse(fs.readFileSync(VALUE_TABLE_PATH, "utf8"));
    valueTable =
      parsed && typeof parsed.values === "object" && parsed.fallback
        ? (parsed as DraftValueTable)
        : null;
  } catch (error) {
    logger.warn("[rankedDraftBot] no draft value table; using stat fallback", {
      error: error instanceof Error ? error.message : String(error),
    });
    valueTable = null;
  }
  return valueTable;
}

const POOL_TTL_MS = 10 * 60 * 1000;
let poolCache: { at: number; cards: DraftPoolCard[] } | null = null;

/** The draftable pool, cached briefly: it only changes with a catalog edit. */
export async function getDraftPool(): Promise<DraftPoolCard[]> {
  if (poolCache && Date.now() - poolCache.at < POOL_TTL_MS) {
    return poolCache.cards;
  }
  const { rows } = await db.query(
    `SELECT cv.card_variant_id, ch.name, cv.rarity,
            (ch.base_power->>'top')::int AS top,
            (ch.base_power->>'right')::int AS "right",
            (ch.base_power->>'bottom')::int AS bottom,
            (ch.base_power->>'left')::int AS "left"
       FROM card_variants cv
       JOIN characters ch ON cv.character_id = ch.character_id
      WHERE ${ORIGINAL_RARITY_SQL}`
  );
  const cards: DraftPoolCard[] = [];
  for (const r of rows) {
    const rarity = String(r.rarity || "").replace(/\+/g, "").toLowerCase();
    const cost = RARITY_POWER_COST[rarity];
    // Same rule as cardPowerCost: an unpriced rarity is not draftable.
    if (cost === undefined) continue;
    cards.push({
      cardVariantId: r.card_variant_id,
      name: r.name,
      rarity,
      cost,
      power: { top: r.top, right: r.right, bottom: r.bottom, left: r.left },
    });
  }
  poolCache = { at: Date.now(), cards };
  return cards;
}

const USAGE_TTL_MS = 30 * 60 * 1000;
/** Recent window, so the bot follows what players draft now. */
const USAGE_WINDOW_DAYS = 30;
/** Below this many finished drafts the counts are noise; bot uses value only. */
const USAGE_MIN_SESSIONS = 20;
let usageCache: { at: number; usage: Map<string, number> } | null = null;

/**
 * How often players drafted each card in recent finished Ranked Drafts, as
 * 0..1 of the most-drafted card. Human seats only: the bot's own picks would
 * otherwise feed back into what it bans. Never throws — no data just means
 * the bot bans and blocks on card value alone.
 */
export async function getDraftUsage(): Promise<Map<string, number>> {
  if (usageCache && Date.now() - usageCache.at < USAGE_TTL_MS) {
    return usageCache.usage;
  }
  const usage = new Map<string, number>();
  try {
    const { rows } = await db.query(
      `WITH recent AS (
         SELECT player1_id, player2_id, player1_picks, player2_picks
           FROM ranked_draft_sessions
          WHERE phase = 'complete'
            AND created_at > now() - make_interval(days => $2::int)
       ), picks AS (
         SELECT jsonb_array_elements_text(player1_picks) AS id
           FROM recent WHERE player1_id <> $1
         UNION ALL
         SELECT jsonb_array_elements_text(player2_picks)
           FROM recent WHERE player2_id <> $1
       )
       SELECT id, count(*)::int AS n,
              (SELECT count(*)::int FROM recent) AS sessions
         FROM picks GROUP BY id`,
      [BOT_USER_ID, USAGE_WINDOW_DAYS]
    );
    const sessions = rows[0]?.sessions ?? 0;
    if (sessions >= USAGE_MIN_SESSIONS) {
      const max = Math.max(...rows.map((r: { n: number }) => r.n));
      for (const r of rows) usage.set(r.id, r.n / max);
    }
  } catch (error) {
    logger.error(
      "[rankedDraftBot] draft usage query failed; banning on value only",
      {},
      error instanceof Error ? error : new Error(String(error))
    );
  }
  usageCache = { at: Date.now(), usage };
  return usage;
}

/** sessionId -> strength, so the human's rating is read once per draft. */
const strengthBySession = new Map<string, number>();

async function strengthFor(session: RankedDraftSession): Promise<number> {
  const cached = strengthBySession.get(session.session_id);
  if (cached !== undefined) return cached;
  let rating = 1000;
  try {
    const { rows } = await db.query(
      `SELECT rating FROM user_rankings WHERE user_id = $1 AND season = $2`,
      [session.player1_id, LeaderboardModel.getRankedDraftSeason()]
    );
    rating = rows[0]?.rating ?? 1000;
  } catch {
    // Default difficulty is fine; never block the bot's move on this.
  }
  const strength = strengthForRating(rating);
  strengthBySession.set(session.session_id, strength);
  // Logged so MIN_STRENGTH can be tuned from real bot-game outcomes
  // (grantBotGameRating logs the result for the same player).
  logger.info("[rankedDraftBot] practice draft difficulty", {
    sessionId: session.session_id,
    userId: session.player1_id,
    rating,
    strength,
  });
  return strength;
}

export function forgetSession(sessionId: string): void {
  strengthBySession.delete(sessionId);
}

async function viewFor(session: RankedDraftSession): Promise<DraftBotView> {
  const botIsP1 = session.player1_id === BOT_USER_ID;
  return {
    pool: await getDraftPool(),
    unavailable: new Set(unavailableCardIds(session)),
    myPicks: botIsP1 ? session.player1_picks : session.player2_picks,
    opponentPicks: botIsP1 ? session.player2_picks : session.player1_picks,
    budgetTotal: RANKED_DRAFT_CONFIG.POWER_BUDGET,
    picksTotal: RANKED_DRAFT_CONFIG.PICKS,
    usage: await getDraftUsage(),
  };
}

export async function chooseBanFor(
  session: RankedDraftSession
): Promise<string | null> {
  return chooseBotBan(await viewFor(session), {
    table: getValueTable(),
    strength: await strengthFor(session),
    looseness: LIVE_LOOSENESS,
    tasteSeed: session.session_id,
    rand: Math.random,
  });
}

export async function choosePickFor(
  session: RankedDraftSession
): Promise<string | null> {
  return chooseBotPick(await viewFor(session), {
    table: getValueTable(),
    strength: await strengthFor(session),
    looseness: LIVE_LOOSENESS,
    tasteSeed: session.session_id,
    rand: Math.random,
  });
}

export async function chooseBlockFor(
  session: RankedDraftSession
): Promise<string | null> {
  return chooseBotBlock(await viewFor(session), {
    table: getValueTable(),
    strength: await strengthFor(session),
    tasteSeed: session.session_id,
    rand: Math.random,
  });
}

/**
 * The finished bot draft as a solo game state: the same deck build as a PvP
 * draft, then the solo-game setup (AI mulligan committed up front, random
 * first player) so it plays through the normal solo REST path.
 */
export async function buildBotGameState(
  humanId: string,
  humanPicks: string[],
  botPicks: string[]
): Promise<GameState> {
  const { gameState } = await buildDraftGameState(
    humanId,
    humanPicks,
    BOT_USER_ID,
    botPicks
  );
  gameState.current_player_id = Math.random() < 0.5 ? humanId : BOT_USER_ID;

  gameState.ranked_bot = true;

  const aiReplaced = chooseAIMulligan(gameState, BOT_USER_ID);
  return applyPlayerMulligan(gameState, BOT_USER_ID, aiReplaced).state;
}

/**
 * Restarts the human's turn clock after a move in a practice-bot game. The
 * clock starts once the move's animations have played, like a PvP turn, and
 * is cleared while it is the bot's turn. No-op for every other game.
 */
export function stampBotTurnDeadline(
  state: GameState,
  events: BaseGameEvent[],
  now: number = Date.now()
): void {
  if (!state.ranked_bot) return;
  if (
    state.status === GameStatus.ACTIVE &&
    state.current_player_id !== BOT_USER_ID
  ) {
    state.turn_deadline_ms =
      now +
      sumAnimationDelay(events) +
      RANKED_DRAFT_CONFIG.BOT_TURN_SECONDS * 1000;
  } else {
    delete state.turn_deadline_ms;
  }
}

/** Whether the human's turn in a practice-bot game has run out. */
export function isBotGameTurnExpired(
  state: GameState,
  userId: string,
  now: number = Date.now()
): boolean {
  return (
    !!state.ranked_bot &&
    state.status === GameStatus.ACTIVE &&
    state.current_player_id === userId &&
    typeof state.turn_deadline_ms === "number" &&
    now >= state.turn_deadline_ms - RANKED_DRAFT_CONFIG.BOT_TIMEOUT_TOLERANCE_MS
  );
}

/**
 * Like any solo game, a bot match costs an ember; without one it still plays
 * but pays no gems or XP. Otherwise unlimited bot games would be a way around
 * the ember gate. Kept separate from buildBotGameState so the caller can spend
 * only once it knows its completion won the race.
 */
export async function spendBotGameEmber(humanId: string): Promise<boolean> {
  return spendEmberForGame(humanId);
}

export interface BotGameRatingResult {
  /** Rating granted for this game: BOT_WIN_RATING, or 0. */
  rating_delta: number;
  /** Bot wins today that granted rating, including this one. */
  rated_wins_today: number;
  rated_wins_per_day: number;
}

/**
 * Grants the flat rating for a finished bot game, once.
 *
 * A win grants BOT_WIN_RATING while the player is under the daily count; a
 * loss, a draw, or a win past the cap grants 0. Only `rating` moves — wins,
 * losses and draws stay PvP-only — and the rank tier/peak follow via the
 * existing user_rankings trigger.
 *
 * Returns null when this game is not a bot game, so every other solo game
 * passes through untouched.
 */
export async function grantBotGameRating(
  gameId: string,
  userId: string,
  winnerId: string | null
): Promise<BotGameRatingResult | null> {
  const session = await RankedDraftSessionModel.findBotSessionByGameId(gameId);
  if (!session || session.player1_id !== userId) return null;

  const perDay = RANKED_DRAFT_CONFIG.BOT_RATED_WINS_PER_DAY;
  const client = await db.getClient();
  try {
    await client.query("BEGIN");
    await RankedDraftSessionModel.lock(session.session_id, client);
    const fresh = await RankedDraftSessionModel.findById(session.session_id, client);
    if (fresh && fresh.bot_rating_delta !== null) {
      // Already granted (a retry or a second completion pass): report it.
      await client.query("ROLLBACK");
      return {
        rating_delta: fresh.bot_rating_delta,
        rated_wins_today: await RankedDraftSessionModel.countRatedBotWinsToday(userId),
        rated_wins_per_day: perDay,
      };
    }

    const before = await RankedDraftSessionModel.countRatedBotWinsToday(userId, client);
    const delta =
      winnerId === userId && before < perDay ? RANKED_DRAFT_CONFIG.BOT_WIN_RATING : 0;

    await RankedDraftSessionModel.setBotRatingDelta(session.session_id, delta, client);
    if (delta > 0) {
      const season = LeaderboardModel.getRankedDraftSeason();
      await LeaderboardModel.getOrCreateUserRanking(userId, season, client);
      await client.query(
        `UPDATE user_rankings
            SET rating = GREATEST(0, LEAST(3000, rating + $1))
          WHERE user_id = $2 AND season = $3`,
        [delta, userId, season]
      );
    }
    await client.query("COMMIT");

    logger.info("[rankedDraftBot] bot game rated", {
      gameId,
      userId,
      won: winnerId === userId,
      delta,
    });
    return {
      rating_delta: delta,
      rated_wins_today: before + (delta > 0 ? 1 : 0),
      rated_wins_per_day: perDay,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export default {
  BOT_USER_ID,
  isBotUser,
  getValueTable,
  getDraftPool,
  getDraftUsage,
  chooseBanFor,
  choosePickFor,
  chooseBlockFor,
  buildBotGameState,
  stampBotTurnDeadline,
  isBotGameTurnExpired,
  spendBotGameEmber,
  grantBotGameRating,
  forgetSession,
};
