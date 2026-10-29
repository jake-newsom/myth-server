import * as _ from "lodash";
import db from "../config/db.config";
import { GameState } from "../types/game.types";
import { BaseGameEvent } from "../types/game-engine.types";
import { InGameCard } from "../types/card.types";
import { GameLogic, GameStatus } from "../game-engine/game.logic";
import * as validators from "../game-engine/game.validators";
import { simulationContext } from "../game-engine/simulation.context";
import {
  AnswerEntry,
  RiddleMove,
  RiddleSolution,
  moveKey,
  scoreDiff,
  solveRiddle,
  winningFirstMoves,
} from "../game-engine/riddle.solver";
import PlayerCosmeticsService from "./playerCosmetics.service";
import { badRequest, conflict, notFound } from "../api/errors/httpError";

/*
 * Weekly Riddle: one "win in 2" puzzle per week, Wednesday 00:00 UTC.
 *
 * Puzzle states are stored with fixed seat ids (RIDDLE_PLAYER moves first,
 * RIDDLE_ORACLE replies). Serving swaps RIDDLE_PLAYER for the viewer's id so
 * the client renders it like any game it owns; incoming card ids are mapped back.
 *
 * Grading replays the frozen week state through the engine under the week's
 * seed, so what the player sees and how they're graded can't disagree. The
 * answer table picks the Oracle's reply and is cross-checked on every finish.
 */

export const RIDDLE_PLAYER = "riddle-player";
export const RIDDLE_ORACLE = "riddle-oracle";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// A puzzle can come back once this many weeks have passed since it last ran.
export const REUSE_AFTER_WEEKS = 26;
const FIRST_SEER_RANKS = 5;

const TITLE_ORACLES_CHOSEN = "oracles_chosen";
const TITLE_FIRST_SEER = "first_seer";
const TITLE_CLEAR_SIGHT = "clear_sight";

interface WeekRow {
  id: string;
  week_number: number;
  puzzle_id: string;
  release_at: Date;
  ends_at: Date;
  seed: string;
  state: GameState;
  answer_table: Record<string, AnswerEntry>;
  solution: { card: string; x: number; y: number };
}

/** Most recent Wednesday 00:00 UTC at or before `now`. */
export function weekStart(now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const daysSinceWed = (d.getUTCDay() - 3 + 7) % 7;
  d.setUTCDate(d.getUTCDate() - daysSinceWed);
  return d;
}

const stripCycles = (v: unknown) =>
  JSON.parse(JSON.stringify(v, (k, val) => (k === "sourceCard" ? undefined : val)));

/** Swaps the stored seat id for the viewer's (or back). Ids are whole JSON tokens or `seat:n` instance ids. */
function swapSeat<T>(value: T, from: string, to: string): T {
  const json = JSON.stringify(value, (k, val) => (k === "sourceCard" ? undefined : val));
  return JSON.parse(json.split(`"${from}"`).join(`"${to}"`).split(`"${from}:`).join(`"${to}:`));
}

const toViewer = <T>(v: T, userId: string) => swapSeat(v, RIDDLE_PLAYER, userId);
const fromViewer = (cardId: string, userId: string) =>
  cardId.startsWith(`${userId}:`) ? `${RIDDLE_PLAYER}:${cardId.slice(userId.length + 1)}` : cardId;

/**
 * Solo clients assume the human is player1 (GameView's playerNumber, the game
 * store's hand handling), so the riddle player always takes that seat.
 */
export function seatPlayerFirst(state: GameState): GameState {
  if (state.player1.user_id === RIDDLE_PLAYER) return state;
  return { ...state, player1: state.player2, player2: state.player1 };
}

/**
 * Converts a harvested sim state (seats sim-p1/sim-p2) to riddle seats:
 * the side to move becomes RIDDLE_PLAYER.
 */
export function normalizeHarvestedState(state: GameState): GameState {
  const me = state.current_player_id;
  const other = state.player1.user_id === me ? state.player2.user_id : state.player1.user_id;
  const s = swapSeat(swapSeat(state, me, RIDDLE_PLAYER), other, RIDDLE_ORACLE);
  s.player1.deck = [];
  s.player2.deck = [];
  s.pending_choice = undefined;
  return seatPlayerFirst(s);
}

function card(state: GameState, id: string): InGameCard {
  return state.hydrated_card_data_cache![id] as InGameCard;
}

function describe(state: GameState, m: RiddleMove) {
  return { card: card(state, m.cardId).base_card_data?.name ?? "", x: m.position.x, y: m.position.y };
}

function isLegal(state: GameState, playerId: string, m: RiddleMove): boolean {
  const player = validators.getPlayer(state, playerId);
  return (
    player.hand.includes(m.cardId) &&
    Number.isInteger(m.position?.x) &&
    Number.isInteger(m.position?.y) &&
    validators.canPlaceOnTile(state, m.position).canPlace
  );
}

/** One placement with its events; hand choices take the strongest pick, empty hands pass. */
async function step(state: GameState, m: RiddleMove): Promise<{ state: GameState; events: BaseGameEvent[] }> {
  const mover = state.current_player_id;
  const placed = await GameLogic.placeCard(_.cloneDeep(state), mover, m.cardId, m.position);
  let s = placed.state;
  const events: BaseGameEvent[] = stripCycles(placed.events);
  if (s.pending_choice) {
    const resolved = await GameLogic.resolveHandChoice(s, GameLogic.pickStrongestPendingChoiceCards(s));
    s = resolved.state;
    events.push(...stripCycles(resolved.events));
  }
  for (let i = 0; i < 4 && s.status === GameStatus.ACTIVE; i++) {
    if (validators.canPlayerPlay(validators.getPlayer(s, s.current_player_id))) break;
    const passed = await GameLogic.forcePass(s, s.current_player_id);
    s = passed.state;
    events.push(...stripCycles(passed.events));
  }
  return { state: s, events };
}

/** Replays a line on the frozen week state, deterministically under the week seed. */
async function replay(week: WeekRow, moves: RiddleMove[]) {
  return simulationContext.withSimulation(async () => {
    let state = _.cloneDeep(week.state);
    const steps: { state: GameState; events: BaseGameEvent[] }[] = [];
    for (const m of moves) {
      const r = await step(state, m);
      state = r.state;
      steps.push(r);
    }
    return { state, steps };
  }, Number(week.seed));
}

/**
 * Refreshes every card from the current catalogue (stats, ability) so a
 * recycled puzzle plays under today's balance. Stat changes are applied as a
 * delta so in-game buffs and debuffs carried by the position survive.
 *
 * Stats live on the character; a variant is only art. A card resolves through
 * its variant id, or by character name when that variant is gone, so only a
 * removed character breaks a puzzle. Returns the names of any that are.
 */
async function refreshCards(state: GameState): Promise<{ state: GameState; missing: string[] }> {
  const s = _.cloneDeep(state);
  const cards = Object.values(s.hydrated_card_data_cache ?? {}) as InGameCard[];
  if (!cards.length) return { state: s, missing: [] };
  const variantIds = [...new Set(cards.map((c) => c.base_card_id))];
  const names = [...new Set(cards.map((c) => c.base_card_data.name))];
  const { rows } = await db.query(
    `SELECT cv.card_variant_id, ch.name, ch.base_power, ch.special_ability_id,
            sa.id AS ability_key, sa.name AS ability_name, sa.description AS ability_description,
            sa.trigger_moments AS ability_triggers, sa.parameters AS ability_parameters,
            sa.sound_effect AS ability_sound_effect
       FROM characters ch
       LEFT JOIN card_variants cv ON cv.character_id = ch.character_id AND cv.card_variant_id = ANY($1::uuid[])
       LEFT JOIN special_abilities sa ON sa.ability_id = ch.special_ability_id
      WHERE cv.card_variant_id IS NOT NULL OR ch.name = ANY($2::text[])`,
    [variantIds, names]
  );
  const byVariant = new Map(rows.filter((r: any) => r.card_variant_id).map((r: any) => [r.card_variant_id, r]));
  const byName = new Map(rows.map((r: any) => [r.name, r]));
  const lookup = (c: InGameCard) => byVariant.get(c.base_card_id) ?? byName.get(c.base_card_data.name);
  const missing = [...new Set(cards.filter((c) => !lookup(c)).map((c) => c.base_card_data.name))];
  if (missing.length) return { state: s, missing };

  const refresh = (c: InGameCard) => {
    const row: any = lookup(c);
    const oldBase = c.base_card_data.base_power;
    for (const side of ["top", "right", "bottom", "left"] as const) {
      const delta = Number(row.base_power[side]) - Number((oldBase as any)[side]);
      (c.base_card_data.base_power as any)[side] += delta;
      c.current_power[side] += delta;
    }
    c.base_card_data.special_ability = row.ability_name
      ? {
          ability_id: row.special_ability_id,
          id: row.ability_key ?? row.special_ability_id,
          name: row.ability_name,
          description: row.ability_description,
          triggerMoments: row.ability_triggers || [],
          parameters: row.ability_parameters,
          sound_effect: row.ability_sound_effect ?? null,
        }
      : null;
  };
  for (const c of cards) refresh(c);
  // Board cells hold their own copies of placed cards.
  for (const row of s.board) for (const cell of row) if (cell?.card) refresh(cell.card);
  return { state: s, missing: [] };
}

export type PuzzleCheck =
  | { ok: true; state: GameState; seed: number; solution: RiddleSolution }
  | { ok: false; reason: "missing_cards"; missing: string[] }
  | { ok: false; reason: "not_unique" | "solve_error"; error?: unknown };

/**
 * Whether a pooled puzzle still has exactly one winning first move under the
 * current catalogue, for the week starting at `releaseAt`. Shared by rotation
 * and scripts/validate-riddle-pool.ts so a dry run predicts what rotation does.
 */
export async function checkPuzzle(
  stored: GameState,
  sourceSeed: string | number | null,
  releaseAt: Date
): Promise<PuzzleCheck> {
  const refreshed = await refreshCards(stored);
  if (refreshed.missing.length) return { ok: false, reason: "missing_cards", missing: refreshed.missing };
  const state = seatPlayerFirst(refreshed.state);
  const seed = Number(sourceSeed ?? 1) + releaseAt.getTime() / 1000;
  try {
    const solution = await solveRiddle(state, seed);
    const recheck = await winningFirstMoves(state, seed + 7919);
    const unique =
      solution.winningFirstKeys.length === 1 &&
      recheck.length === 1 &&
      moveKey(state, recheck[0]) === solution.winningFirstKeys[0];
    return unique ? { ok: true, state, seed, solution } : { ok: false, reason: "not_unique" };
  } catch (error) {
    return { ok: false, reason: "solve_error", error };
  }
}

const RiddleService = {
  weekStart,

  /**
   * Opens this week's riddle if it isn't open yet. Safe to call repeatedly and
   * from several instances (advisory lock + unique release_at).
   */
  async rotateWeek(now = new Date()): Promise<{ weekNumber: number; puzzleId: string } | null> {
    const releaseAt = weekStart(now);
    const client = await db.getClient();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('riddle_rotate'))");
      const existing = await client.query(
        "SELECT week_number, puzzle_id FROM riddle_weeks WHERE release_at = $1",
        [releaseAt]
      );
      if (existing.rows.length) {
        await client.query("COMMIT");
        return null;
      }

      const cutoff = new Date(releaseAt.getTime() - REUSE_AFTER_WEEKS * WEEK_MS);
      const candidates = await client.query(
        `SELECT id, state, source_seed FROM riddle_puzzles
          WHERE status = 'approved' AND (last_used_at IS NULL OR last_used_at < $1)
          ORDER BY times_used ASC, last_used_at ASC NULLS FIRST, random()
          LIMIT 25`,
        [cutoff]
      );

      for (const row of candidates.rows) {
        const check = await checkPuzzle(row.state, row.source_seed, releaseAt);
        if (!check.ok) {
          if (check.reason === "missing_cards") {
            // A removed character never comes back, so this one is done for good.
            await client.query(
              "UPDATE riddle_puzzles SET status = 'retired', notes = concat_ws('; ', notes, $2::text) WHERE id = $1",
              [row.id, `retired at rotation: missing ${check.missing.join(", ")}`]
            );
          } else {
            // Random abilities make uniqueness seed-dependent; next week's seed may work, so skip without retiring.
            const why = check.reason === "solve_error" ? check.error : "no unique solution under this week's seed";
            console.warn(`[riddle] skipped puzzle ${row.id} for this week:`, why);
          }
          continue;
        }

        const { state, seed, solution } = check;
        const winning = solution.answers[solution.winningFirstKeys[0]];
        const { rows: numRows } = await client.query("SELECT COALESCE(MAX(week_number), 0) + 1 AS n FROM riddle_weeks");
        const weekNumber = numRows[0].n;
        await client.query(
          `INSERT INTO riddle_weeks (week_number, puzzle_id, release_at, ends_at, seed, state, answer_table, solution)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            weekNumber,
            row.id,
            releaseAt,
            new Date(releaseAt.getTime() + WEEK_MS),
            seed,
            JSON.stringify(stripCycles(state)),
            JSON.stringify(stripCycles(solution.answers)),
            JSON.stringify(describe(state, winning.first)),
          ]
        );
        await client.query(
          "UPDATE riddle_puzzles SET last_used_at = $2, times_used = times_used + 1 WHERE id = $1",
          [row.id, releaseAt]
        );
        await client.query("COMMIT");
        console.log(`[riddle] week #${weekNumber} opened with puzzle ${row.id}`);
        return { weekNumber, puzzleId: row.id };
      }

      // Nothing usable: keep last week's riddle running rather than going dark.
      await client.query(
        `UPDATE riddle_weeks SET ends_at = $1
          WHERE id = (SELECT id FROM riddle_weeks ORDER BY release_at DESC LIMIT 1)`,
        [new Date(releaseAt.getTime() + WEEK_MS)]
      );
      await client.query("COMMIT");
      console.error("[riddle] no approved puzzle passed re-solve; extended last week");
      return null;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  },

  async getLiveWeek(now = new Date()): Promise<WeekRow | null> {
    const { rows } = await db.query(
      `SELECT * FROM riddle_weeks WHERE release_at <= $1 AND ends_at > $1
        ORDER BY release_at DESC LIMIT 1`,
      [now]
    );
    return rows[0] ?? null;
  },

  async requireLiveWeek(): Promise<WeekRow> {
    const week = await this.getLiveWeek();
    if (!week) throw notFound("No riddle is live right now", "RIDDLE_NOT_LIVE");
    return week;
  },

  async getCurrent(userId: string) {
    const week = await this.getLiveWeek();
    if (!week) return { week: null };

    const [progressRes, activeRes, lastRes] = await Promise.all([
      db.query("SELECT attempts, attempts_to_clear, clear_rank, first_cleared_at FROM riddle_progress WHERE week_id = $1 AND user_id = $2", [week.id, userId]),
      db.query(
        `SELECT id, attempt_no, first_move, server_reply FROM riddle_attempts
          WHERE week_id = $1 AND user_id = $2 AND finished_at IS NULL
          ORDER BY created_at DESC LIMIT 1`,
        [week.id, userId]
      ),
      db.query(
        "SELECT week_number, solution FROM riddle_weeks WHERE release_at < $1 ORDER BY release_at DESC LIMIT 1",
        [week.release_at]
      ),
    ]);

    let activeAttempt = null;
    const active = activeRes.rows[0];
    if (active?.server_reply) {
      const { state } = await replay(week, [active.first_move, active.server_reply]);
      activeAttempt = {
        attemptId: active.id,
        attemptNo: active.attempt_no,
        state: toViewer(state, userId),
      };
    }

    const p = progressRes.rows[0];
    return {
      week: {
        id: week.id,
        number: week.week_number,
        releaseAt: week.release_at,
        endsAt: week.ends_at,
      },
      state: toViewer(week.state, userId),
      opponentId: RIDDLE_ORACLE,
      progress: {
        attempts: p?.attempts ?? 0,
        attemptsToClear: p?.attempts_to_clear ?? null,
        clearRank: p?.clear_rank ?? null,
        clearedAt: p?.first_cleared_at ?? null,
      },
      activeAttempt,
      lastWeek: lastRes.rows[0]
        ? { number: lastRes.rows[0].week_number, solution: lastRes.rows[0].solution }
        : null,
    };
  },

  /** First move of a new attempt: returns the Oracle's reply and the events for both placements. */
  async startAttempt(userId: string, move: RiddleMove) {
    const week = await this.requireLiveWeek();
    const first: RiddleMove = { cardId: fromViewer(String(move?.cardId ?? ""), userId), position: move?.position };
    if (!isLegal(week.state, RIDDLE_PLAYER, first)) throw badRequest("That move isn't legal here", "RIDDLE_ILLEGAL_MOVE");

    const entry = week.answer_table[moveKey(week.state, first)];
    if (!entry) throw badRequest("That move isn't legal here", "RIDDLE_ILLEGAL_MOVE");

    const afterFirst = await replay(week, [first]);
    let reply = entry.reply;
    if (reply && !isLegal(afterFirst.state, RIDDLE_ORACLE, reply)) {
      console.error(`[riddle] week ${week.week_number}: stored reply illegal after ${moveKey(week.state, first)}; using first legal`);
      reply = null;
    }
    if (!reply && afterFirst.state.status === GameStatus.ACTIVE && afterFirst.state.current_player_id === RIDDLE_ORACLE) {
      const opp = validators.getPlayer(afterFirst.state, RIDDLE_ORACLE);
      const tile = afterFirst.state.board.flatMap((row, y) => row.map((_c, x) => ({ x, y })))
        .find((pos) => validators.canPlaceOnTile(afterFirst.state, pos).canPlace);
      if (tile && opp.hand[0]) reply = { cardId: opp.hand[0], position: tile };
    }

    const line = reply ? [first, reply] : [first];
    const played = await replay(week, line);

    const client = await db.getClient();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `INSERT INTO riddle_progress (week_id, user_id, attempts) VALUES ($1, $2, 1)
         ON CONFLICT (week_id, user_id) DO UPDATE SET attempts = riddle_progress.attempts + 1
         RETURNING attempts`,
        [week.id, userId]
      );
      // Abandoned attempts stay counted; only the latest one can be finished.
      await client.query(
        "UPDATE riddle_attempts SET finished_at = now() WHERE week_id = $1 AND user_id = $2 AND finished_at IS NULL",
        [week.id, userId]
      );
      const attemptNo = rows[0].attempts;
      const ins = await client.query(
        `INSERT INTO riddle_attempts (week_id, user_id, attempt_no, first_move, server_reply)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [week.id, userId, attemptNo, JSON.stringify(first), reply ? JSON.stringify(reply) : null]
      );
      await client.query("COMMIT");

      return {
        attemptId: ins.rows[0].id,
        attemptNo,
        reply: reply ? toViewer({ ...describe(played.steps[0].state, reply), cardId: reply.cardId }, userId) : null,
        steps: played.steps.map((s) => ({ events: toViewer(s.events, userId), state: toViewer(s.state, userId) })),
        state: toViewer(played.state, userId),
        gameOver: played.state.status !== GameStatus.ACTIVE,
      };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  },

  /** Final move of an attempt. Grades it, ranks first clears, grants titles. */
  async finishAttempt(userId: string, attemptId: string, move: RiddleMove | null) {
    const week = await this.requireLiveWeek();
    const { rows: attemptRows } = await db.query(
      "SELECT * FROM riddle_attempts WHERE id = $1 AND user_id = $2 AND week_id = $3",
      [attemptId, userId, week.id]
    );
    const attempt = attemptRows[0];
    if (!attempt) throw notFound("Attempt not found", "RIDDLE_ATTEMPT_NOT_FOUND");
    if (attempt.finished_at) throw conflict("Attempt already finished", "RIDDLE_ATTEMPT_FINISHED");

    const line: RiddleMove[] = [attempt.first_move, ...(attempt.server_reply ? [attempt.server_reply] : [])];
    const before = await replay(week, line);
    let played = before;
    let finalMove: RiddleMove | null = null;

    if (before.state.status === GameStatus.ACTIVE) {
      finalMove = { cardId: fromViewer(String(move?.cardId ?? ""), userId), position: move?.position as any };
      if (!isLegal(before.state, RIDDLE_PLAYER, finalMove)) throw badRequest("That move isn't legal here", "RIDDLE_ILLEGAL_MOVE");
      played = await replay(week, [...line, finalMove]);
    }

    const final = played.state;
    const cleared = final.status !== GameStatus.ACTIVE && final.winner === RIDDLE_PLAYER;

    // Cross-check against the frozen answer table; a mismatch means engine drift since go-live.
    const entry = week.answer_table[moveKey(week.state, attempt.first_move)];
    const tableSays = !!entry?.correct && (finalMove ? entry.winningFinals.includes(moveKey(before.state, finalMove)) : entry.winningFinals.includes("*"));
    if (tableSays !== cleared) {
      console.error(`[riddle] week ${week.week_number}: engine says cleared=${cleared}, table says ${tableSays} (attempt ${attemptId})`);
    }

    const client = await db.getClient();
    let clearRank: number | null = null;
    let attemptsToClear: number | null = null;
    const titlesGranted: string[] = [];
    try {
      await client.query("BEGIN");
      // Serializes clears so ranks are unique.
      await client.query("SELECT id FROM riddle_weeks WHERE id = $1 FOR UPDATE", [week.id]);
      const upd = await client.query(
        `UPDATE riddle_attempts SET final_move = $2, cleared = $3, finished_at = now()
          WHERE id = $1 AND finished_at IS NULL RETURNING id`,
        [attemptId, finalMove ? JSON.stringify(finalMove) : null, cleared]
      );
      if (!upd.rowCount) throw conflict("Attempt already finished", "RIDDLE_ATTEMPT_FINISHED");

      const { rows: prog } = await client.query(
        "SELECT attempts_to_clear, clear_rank FROM riddle_progress WHERE week_id = $1 AND user_id = $2",
        [week.id, userId]
      );
      attemptsToClear = prog[0]?.attempts_to_clear ?? null;
      clearRank = prog[0]?.clear_rank ?? null;

      if (cleared && attemptsToClear === null) {
        const { rows: cnt } = await client.query(
          "SELECT COUNT(*)::int AS n FROM riddle_progress WHERE week_id = $1 AND attempts_to_clear IS NOT NULL",
          [week.id]
        );
        clearRank = cnt[0].n + 1;
        attemptsToClear = attempt.attempt_no;
        await client.query(
          `UPDATE riddle_progress SET attempts_to_clear = $3, clear_rank = $4, first_cleared_at = now()
            WHERE week_id = $1 AND user_id = $2`,
          [week.id, userId, attemptsToClear, clearRank]
        );

        const earned = [
          clearRank === 1 && TITLE_ORACLES_CHOSEN,
          clearRank! <= FIRST_SEER_RANKS && TITLE_FIRST_SEER,
          attemptsToClear === 1 && TITLE_CLEAR_SIGHT,
        ].filter(Boolean) as string[];
        if (earned.length) {
          const { rows: titles } = await client.query(
            "SELECT title_id, code_key, name FROM titles WHERE code_key = ANY($1::text[])",
            [earned]
          );
          for (const t of titles) {
            if (await PlayerCosmeticsService.grantTitle(userId, t.title_id, "weekly_riddle", client)) {
              titlesGranted.push(t.name);
            }
          }
        }
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    return {
      cleared,
      attemptNo: attempt.attempt_no,
      attemptsToClear,
      clearRank,
      titlesGranted,
      score: (() => {
        const d = validators.calculateScores(final.board as any, final.player1.user_id, final.player2.user_id);
        const mine = final.player1.user_id === RIDDLE_PLAYER ? d.player1Score : d.player2Score;
        return { player: mine, opponent: mine - scoreDiff(final, RIDDLE_PLAYER) };
      })(),
      steps: finalMove
        ? [{ events: toViewer(played.steps[played.steps.length - 1].events, userId), state: toViewer(final, userId) }]
        : [],
      state: toViewer(final, userId),
    };
  },

  async getLeaderboard(userId: string, limit = 50) {
    const week = await this.getLiveWeek();
    if (!week) return { week: null, rankings: [], me: null, distribution: [], totals: { players: 0, cleared: 0 } };
    const lim = Math.min(Math.max(1, limit), 100);

    const [top, me, dist, totals] = await Promise.all([
      db.query(
        `SELECT u.user_id, u.username, t.name AS title, p.attempts_to_clear, p.first_cleared_at, p.clear_rank,
                RANK() OVER (ORDER BY p.attempts_to_clear, p.first_cleared_at) AS rank
           FROM riddle_progress p
           JOIN users u ON u.user_id = p.user_id
           LEFT JOIN titles t ON t.title_id = u.equipped_title_id
          WHERE p.week_id = $1 AND p.attempts_to_clear IS NOT NULL
          ORDER BY p.attempts_to_clear, p.first_cleared_at
          LIMIT $2`,
        [week.id, lim]
      ),
      db.query(
        `SELECT p.attempts, p.attempts_to_clear, p.first_cleared_at, p.clear_rank,
                CASE WHEN p.attempts_to_clear IS NULL THEN NULL ELSE (
                  SELECT COUNT(*)::int + 1 FROM riddle_progress o
                   WHERE o.week_id = p.week_id AND o.attempts_to_clear IS NOT NULL
                     AND (o.attempts_to_clear, o.first_cleared_at) < (p.attempts_to_clear, p.first_cleared_at)
                ) END AS rank
           FROM riddle_progress p WHERE p.week_id = $1 AND p.user_id = $2`,
        [week.id, userId]
      ),
      db.query(
        `SELECT LEAST(attempts_to_clear, 5) AS tries, COUNT(*)::int AS n
           FROM riddle_progress WHERE week_id = $1 AND attempts_to_clear IS NOT NULL
          GROUP BY 1 ORDER BY 1`,
        [week.id]
      ),
      db.query(
        `SELECT COUNT(*)::int AS players, COUNT(attempts_to_clear)::int AS cleared
           FROM riddle_progress WHERE week_id = $1`,
        [week.id]
      ),
    ]);

    const m = me.rows[0];
    return {
      week: { id: week.id, number: week.week_number, endsAt: week.ends_at },
      rankings: top.rows.map((r: any) => ({
        rank: Number(r.rank),
        userId: r.user_id,
        username: r.username,
        title: r.title ?? null,
        attemptsToClear: r.attempts_to_clear,
        clearedAt: r.first_cleared_at,
        clearOrder: r.clear_rank,
        isMe: r.user_id === userId,
      })),
      me: m
        ? { rank: m.rank, attempts: m.attempts, attemptsToClear: m.attempts_to_clear, clearedAt: m.first_cleared_at, clearOrder: m.clear_rank }
        : null,
      // tries = 5 means "5 or more".
      distribution: dist.rows.map((r: any) => ({ tries: r.tries, players: r.n })),
      totals: totals.rows[0],
    };
  },

  /** Admin: import harvester output as candidates. */
  async importCandidates(puzzles: { seed: number; state: GameState }[]): Promise<number> {
    let n = 0;
    for (const p of puzzles) {
      const state = normalizeHarvestedState(p.state);
      const cardIds = [...new Set(Object.values(state.hydrated_card_data_cache ?? {}).map((c: any) => c.base_card_id))];
      await db.query(
        "INSERT INTO riddle_puzzles (source_seed, state, card_ids) VALUES ($1, $2, $3)",
        [p.seed, JSON.stringify(stripCycles(state)), cardIds]
      );
      n++;
    }
    return n;
  },

  async listPuzzles(status?: string, limit = 50, offset = 0) {
    const { rows } = await db.query(
      `SELECT id, status, source_seed, notes, last_used_at, times_used, created_at, state
         FROM riddle_puzzles WHERE ($1::text IS NULL OR status = $1)
        ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [status ?? null, Math.min(limit, 200), offset]
    );
    return rows;
  },

  async setPuzzleStatus(id: string, status: "candidate" | "approved" | "retired") {
    const { rowCount } = await db.query("UPDATE riddle_puzzles SET status = $2 WHERE id = $1", [id, status]);
    if (!rowCount) throw notFound("Puzzle not found", "RIDDLE_PUZZLE_NOT_FOUND");
  },

  /** Retention: attempts are only needed for the live week's grading and short-term stats. */
  async pruneAttempts(olderThanDays = 90): Promise<number> {
    const { rowCount } = await db.query(
      "DELETE FROM riddle_attempts WHERE created_at < now() - ($1 || ' days')::interval",
      [String(olderThanDays)]
    );
    return rowCount ?? 0;
  },
};

export default RiddleService;
