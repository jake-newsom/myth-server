/**
 * Server-side game outcome events for the onboarding funnel and core-loop
 * reports (TRACKING.md). Every function is fire-and-forget and never throws:
 * analytics must not slow down or break a game.
 */
import db from "../config/db.config";
import { captureServerEvent, isTelemetryEnabled } from "../utils/telemetry";

/** Kind of game, finer than games.game_mode (tower and saga run as "solo"). */
export type GameKind =
  | "solo"
  | "tower"
  | "saga"
  | "pvp"
  | "friend_challenge"
  | "ranked_draft"
  | "ranked_draft_bot"
  | "tutorial";

const AI_ID_PREFIXES = ["00000000-0000-0000-0000-"];

function isHumanId(id: string | null | undefined): id is string {
  return !!id && !AI_ID_PREFIXES.some((p) => id.startsWith(p));
}

/** True when the user has no other non-tutorial game. */
async function isFirstGame(userId: string, gameId: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM games
     WHERE (player1_id = $1 OR player2_id = $1)
       AND game_id <> $2
       AND COALESCE(is_tutorial, false) = false
     LIMIT 1`,
    [userId, gameId],
  );
  return rows.length === 0;
}

/** Days since signup, or null for AI/bot accounts (which are never tracked). */
async function humanDaysSinceSignup(userId: string): Promise<number | null> {
  const { rows } = await db.query(
    `SELECT FLOOR(EXTRACT(EPOCH FROM (now() - created_at)) / 86400)::int AS d,
            COALESCE(is_ai, false) AS is_ai
     FROM users WHERE user_id = $1`,
    [userId],
  );
  if (!rows[0] || rows[0].is_ai) return null;
  return rows[0].d ?? 0;
}

export function trackGameStarted(params: {
  gameId: string | null | undefined;
  userIds: Array<string | null | undefined>;
  mode: string;
  kind: GameKind;
}): void {
  if (!isTelemetryEnabled() || !params.gameId) return;
  const gameId = params.gameId;
  for (const userId of params.userIds.filter(isHumanId)) {
    void (async () => {
      const days = await humanDaysSinceSignup(userId);
      if (days === null) return;
      const first = await isFirstGame(userId, gameId);
      captureServerEvent(userId, "game_started", {
        game_id: gameId,
        mode: params.mode,
        kind: params.kind,
        is_first_game: first,
        days_since_signup: days,
      });
    })().catch((e) => console.error("[telemetry] game_started failed:", e));
  }
}

export function trackGameCompleted(params: {
  gameId: string | null | undefined;
  userId: string;
  mode: string;
  kind?: GameKind;
  result: "win" | "loss" | "draw";
  turns?: number | null;
  durationSeconds?: number | null;
  isForfeit?: boolean;
}): void {
  if (!isTelemetryEnabled() || !params.gameId || !isHumanId(params.userId)) {
    return;
  }
  const gameId = params.gameId;
  void (async () => {
    const days = await humanDaysSinceSignup(params.userId);
    if (days === null) return;
    const first = await isFirstGame(params.userId, gameId);
    captureServerEvent(params.userId, "game_completed", {
      game_id: gameId,
      mode: params.mode,
      kind: params.kind ?? params.mode,
      result: params.result,
      turns: params.turns ?? null,
      duration_s: params.durationSeconds ?? null,
      is_forfeit: !!params.isForfeit,
      is_first_game: first,
      days_since_signup: days,
    });
  })().catch((e) => console.error("[telemetry] game_completed failed:", e));
}
