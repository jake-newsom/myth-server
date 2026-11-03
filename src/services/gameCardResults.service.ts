/**
 * Writes game_card_results: one row per card in a player's deck per finished
 * game (TRACKING.md "Per-card game results"), read by the balance report.
 */
import db from "../config/db.config";
import { GameState } from "../types/game.types";

export type CardResult = "win" | "loss" | "draw";

export interface GameCardResultRow {
  card_instance_id: string;
  character_id: string | null;
  variant_id: string | null;
  was_played: boolean;
}

/**
 * Every card the player brought (hand + deck + discard + their cards on the
 * board, flipped or not). A card counts as played once it left the hand:
 * discard pile or on the board.
 */
export function collectDeckCardResults(
  gameState: GameState,
  userId: string,
): GameCardResultRow[] {
  const player =
    gameState.player1?.user_id === userId
      ? gameState.player1
      : gameState.player2?.user_id === userId
        ? gameState.player2
        : null;
  if (!player) return [];

  const played = new Set<string>(player.discard_pile ?? []);
  for (const row of gameState.board ?? []) {
    for (const tile of row ?? []) {
      const card = tile?.card as
        | { original_owner?: string; owner?: string; user_card_instance_id?: string }
        | null
        | undefined;
      if (!card?.user_card_instance_id) continue;
      if ((card.original_owner ?? card.owner) === userId) {
        played.add(card.user_card_instance_id);
      }
    }
  }

  const all = new Set<string>([
    ...(player.hand ?? []),
    ...(player.deck ?? []),
    ...played,
  ]);

  const cache = gameState.hydrated_card_data_cache ?? {};
  const rows: GameCardResultRow[] = [];
  for (const id of all) {
    const base = cache[id]?.base_card_data as
      | { card_id?: string; character_id?: string | null }
      | undefined;
    rows.push({
      card_instance_id: id,
      character_id: base?.character_id || null,
      variant_id: base?.card_id || null,
      was_played: played.has(id),
    });
  }
  return rows;
}

export function resultFor(winner: string | null, userId: string): CardResult {
  if (winner === null) return "draw";
  return winner === userId ? "win" : "loss";
}

/** Idempotent: a retried completion inserts nothing new. */
export async function recordGameCardResults(params: {
  gameId: string;
  userId: string;
  gameMode: string;
  gameState: GameState;
  winner: string | null;
  /** When the game finished; defaults to now. Set by the retention backfill. */
  createdAt?: Date;
}): Promise<number> {
  const rows = collectDeckCardResults(params.gameState, params.userId);
  if (rows.length === 0) return 0;
  const { rowCount } = await db.query(
    `INSERT INTO game_card_results
       (game_id, user_id, game_mode, card_instance_id, character_id, variant_id, was_played, result, created_at)
     SELECT $1, $2, $3, t.card_instance_id, t.character_id, t.variant_id, t.was_played, $4, COALESCE($9::timestamptz, NOW())
     FROM UNNEST($5::text[], $6::text[], $7::text[], $8::boolean[])
       AS t(card_instance_id, character_id, variant_id, was_played)
     ON CONFLICT (game_id, user_id, card_instance_id) DO NOTHING`,
    [
      params.gameId,
      params.userId,
      params.gameMode,
      resultFor(params.winner, params.userId),
      rows.map((r) => r.card_instance_id),
      rows.map((r) => r.character_id),
      rows.map((r) => r.variant_id),
      rows.map((r) => r.was_played),
      params.createdAt ?? null,
    ],
  );
  return rowCount ?? 0;
}
