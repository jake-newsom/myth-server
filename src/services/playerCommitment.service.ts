import db from "../config/db.config";
import RankedDraftSessionModel from "../models/rankedDraftSession.model";

/**
 * What a player is already locked into, if anything.
 *
 * Challenges, the unranked queue and Ranked Draft each used to guard only
 * their own state, so one player could hold a live draft AND a challenge game
 * at once. The client then routed between them on whichever event landed
 * last, stranding one game. Every entry point into a live match checks this.
 */
export type LiveCommitment =
  | { kind: "draft"; sessionId: string }
  | { kind: "game"; gameId: string };

// Matches the unranked queue's stale threshold: older "active" rows are
// crashed/abandoned sessions and must not lock a player out forever.
const STALE_GAME_THRESHOLD = "2 hours";

export async function findLiveCommitment(
  userId: string
): Promise<LiveCommitment | null> {
  const session = await RankedDraftSessionModel.findLiveForUser(userId);
  if (session) return { kind: "draft", sessionId: session.session_id };

  // Solo/tower games never block. A practice-bot draft game is a solo row,
  // found through the bot session that produced it.
  const { rows } = await db.query(
    `SELECT g.game_id FROM "games" g
     WHERE (g.player1_id = $1 OR g.player2_id = $1)
       AND g.game_status IN ('pending', 'mulligan', 'active')
       AND g.created_at > NOW() - INTERVAL '${STALE_GAME_THRESHOLD}'
       AND (
         g.game_mode IN ('pvp', 'ranked_draft')
         OR EXISTS (
           SELECT 1 FROM ranked_draft_sessions s
            WHERE s.game_id = g.game_id AND s.vs_bot
         )
       )
     LIMIT 1`,
    [userId]
  );
  if (rows.length > 0) return { kind: "game", gameId: rows[0].game_id };

  return null;
}
