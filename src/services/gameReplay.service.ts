/**
 * Compact replay records (game_replays), kept 30 days.
 *
 * Not a deterministic re-simulation: live games roll random abilities with
 * Math.random and store no seed. The record is enough to show the game move by
 * move (who played which card where, and with what starting stats) and the
 * final board, which is what the in-game modifiers need: cards' starting
 * stats include level and Forge enhancements, which can't be re-derived from
 * user_owned_cards later.
 */
import db from "../config/db.config";
import { GameState, ReplayMove } from "../types/game.types";
import { PowerValues } from "../types/card.types";

export const REPLAY_FORMAT_VERSION = 1;

/** [top, right, bottom, left] */
type Power4 = [number, number, number, number];

export interface ReplayCard {
  ch: string | null; // character_id
  v: string | null; // variant (base card) id
  o: 1 | 2; // original owner side
  lv?: number;
  bp?: Power4; // base power
  pe?: Power4; // power enhancements (Forge etc.)
  rune?: string;
}

export interface ReplayRecord {
  v: number;
  cards: Record<string, ReplayCard>;
  /** null when the game predates move logging. */
  moves: ReplayMove[] | null;
  /** board[y][x]: [instance id, owner side, current power] or null. */
  board: ([string, 1 | 2, Power4] | null)[][];
  surrendered_by?: 1 | 2;
  turns: number;
}

const p4 = (p?: Partial<PowerValues> | null): Power4 | undefined =>
  p
    ? [p.top ?? 0, p.right ?? 0, p.bottom ?? 0, p.left ?? 0]
    : undefined;

export function buildReplayRecord(state: GameState): ReplayRecord | null {
  if (!state?.player1 || !state.board) return null;
  const side = (userId?: string | null): 1 | 2 =>
    userId === state.player1.user_id ? 1 : 2;

  const cards: Record<string, ReplayCard> = {};
  for (const [id, card] of Object.entries(state.hydrated_card_data_cache ?? {})) {
    const base = card?.base_card_data as
      | { card_id?: string; character_id?: string; base_power?: PowerValues }
      | undefined;
    const entry: ReplayCard = {
      ch: base?.character_id ?? null,
      v: base?.card_id ?? null,
      o: side(card.original_owner ?? card.owner),
    };
    if (card.level) entry.lv = card.level;
    const bp = p4(base?.base_power);
    if (bp) entry.bp = bp;
    const pe = p4(card.power_enhancements);
    if (pe && pe.some((n) => n !== 0)) entry.pe = pe;
    if (card.saga_rune_type) entry.rune = card.saga_rune_type;
    cards[id] = entry;
  }

  const board = state.board.map((row) =>
    (row ?? []).map((tile) => {
      const c = tile?.card as
        | { user_card_instance_id?: string; owner?: string; current_power?: PowerValues }
        | null
        | undefined;
      if (!c?.user_card_instance_id) return null;
      return [
        c.user_card_instance_id,
        side(c.owner),
        p4(c.current_power) ?? [0, 0, 0, 0],
      ] as [string, 1 | 2, Power4];
    }),
  );

  return {
    v: REPLAY_FORMAT_VERSION,
    cards,
    moves: state.move_log ?? null,
    board,
    ...(state.surrendered_by ? { surrendered_by: side(state.surrendered_by) } : {}),
    turns: state.turn_number ?? 0,
  };
}

/** Idempotent: the first record for a game wins. */
export async function recordGameReplay(params: {
  gameId: string;
  gameMode: string;
  gameState: GameState;
  player1Id?: string | null;
  player2Id?: string | null;
  winnerId?: string | null;
  finishedAt?: Date | null;
  client?: { query: typeof db.query };
}): Promise<boolean> {
  const record = buildReplayRecord(params.gameState);
  if (!record) return false;
  const q = params.client ?? db;
  const { rowCount } = await q.query(
    `INSERT INTO game_replays
       (game_id, game_mode, player1_id, player2_id, winner_id, record, finished_at)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, NOW()))
     ON CONFLICT (game_id) DO NOTHING`,
    [
      params.gameId,
      params.gameMode,
      params.player1Id ?? null,
      params.player2Id ?? null,
      params.winnerId ?? null,
      JSON.stringify(record),
      params.finishedAt ?? null,
    ],
  );
  return (rowCount ?? 0) > 0;
}
