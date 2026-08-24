import db, { QueryExecutor } from "../config/db.config";
import { RankedDraftPhase } from "../types/socket.types";

/** A row of `ranked_draft_sessions`. */
export interface RankedDraftSession {
  session_id: string;
  player1_id: string;
  player2_id: string;
  phase: RankedDraftPhase;
  player1_ban: string | null;
  player2_ban: string | null;
  player1_picks: string[];
  player2_picks: string[];
  /** original_variant_id -> chosen (owned, cosmetic) variant_id. */
  player1_variants: Record<string, string>;
  player2_variants: Record<string, string>;
  /**
   * Block phase: the card each player removed from the OPPONENT's draft.
   * `player1_block` is the card player1 took out of player2's deck.
   */
  player1_block: string | null;
  player2_block: string | null;
  current_picker_id: string | null;
  pick_index: number;
  deadline_at: Date | null;
  game_id: string | null;
  created_at: Date;
  updated_at: Date;
}

const SELECT_COLUMNS = `
  session_id, player1_id, player2_id, phase,
  player1_ban, player2_ban, player1_picks, player2_picks,
  player1_variants, player2_variants,
  player1_block, player2_block,
  current_picker_id, pick_index, deadline_at, game_id,
  created_at, updated_at
`;

const RankedDraftSessionModel = {
  async create(
    player1Id: string,
    player2Id: string,
    banDeadline: Date,
    executor: QueryExecutor = db
  ): Promise<RankedDraftSession> {
    const { rows } = await executor.query(
      `INSERT INTO ranked_draft_sessions (player1_id, player2_id, phase, deadline_at)
       VALUES ($1, $2, 'ban', $3)
       RETURNING ${SELECT_COLUMNS}`,
      [player1Id, player2Id, banDeadline]
    );
    return rows[0];
  },

  async findById(
    sessionId: string,
    executor: QueryExecutor = db
  ): Promise<RankedDraftSession | null> {
    const { rows } = await executor.query(
      `SELECT ${SELECT_COLUMNS} FROM ranked_draft_sessions WHERE session_id = $1`,
      [sessionId]
    );
    return rows[0] ?? null;
  },

  /** The caller's live (ban or draft) session, if any. */
  async findLiveForUser(
    userId: string,
    executor: QueryExecutor = db
  ): Promise<RankedDraftSession | null> {
    const { rows } = await executor.query(
      `SELECT ${SELECT_COLUMNS} FROM ranked_draft_sessions
       WHERE (player1_id = $1 OR player2_id = $1)
         AND phase IN ('ban', 'draft', 'block')
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );
    return rows[0] ?? null;
  },

  /**
   * The caller's most recent session that COMPLETED into a game very recently.
   *
   * Recovery only. A client stranded on the block screen (it missed
   * `draft:completed`, or the session completed while it was disconnected) has
   * no live session to rejoin, so every recovery path used to answer "no draft"
   * while a real game sat waiting for it. This finds the game to send them to.
   *
   * Bounded by age so it can only ever resolve the hand-off that just happened,
   * never drag a player back into an older finished draft.
   */
  async findRecentlyCompletedForUser(
    userId: string,
    maxAgeMinutes: number,
    executor: QueryExecutor = db
  ): Promise<RankedDraftSession | null> {
    const { rows } = await executor.query(
      `SELECT ${SELECT_COLUMNS} FROM ranked_draft_sessions
       WHERE (player1_id = $1 OR player2_id = $1)
         AND phase = 'complete'
         AND game_id IS NOT NULL
         AND updated_at > NOW() - ($2 || ' minutes')::interval
       ORDER BY updated_at DESC
       LIMIT 1`,
      [userId, String(maxAgeMinutes)]
    );
    return rows[0] ?? null;
  },

  /**
   * Serializes concurrent writes to one session.
   *
   * Two picks landing at once must not be able to take the same card, and the
   * auto-pick timer races real picks by construction. Same advisory-lock idiom
   * LeaderboardModel.recordGameResult uses.
   */
  async lock(sessionId: string, executor: QueryExecutor): Promise<void> {
    await executor.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      sessionId,
    ]);
  },

  async setBan(
    sessionId: string,
    isPlayer1: boolean,
    cardVariantId: string,
    executor: QueryExecutor = db
  ): Promise<RankedDraftSession> {
    const column = isPlayer1 ? "player1_ban" : "player2_ban";
    const { rows } = await executor.query(
      `UPDATE ranked_draft_sessions
       SET ${column} = $2, updated_at = NOW()
       WHERE session_id = $1
       RETURNING ${SELECT_COLUMNS}`,
      [sessionId, cardVariantId]
    );
    return rows[0];
  },

  /** Ban phase -> draft phase, handing the clock to the first picker. */
  async beginDraftPhase(
    sessionId: string,
    firstPickerId: string,
    deadline: Date,
    executor: QueryExecutor = db
  ): Promise<RankedDraftSession> {
    const { rows } = await executor.query(
      `UPDATE ranked_draft_sessions
       SET phase = 'draft', current_picker_id = $2, deadline_at = $3, updated_at = NOW()
       WHERE session_id = $1
       RETURNING ${SELECT_COLUMNS}`,
      [sessionId, firstPickerId, deadline]
    );
    return rows[0];
  },

  /** Draft is full: move into the simultaneous block phase. */
  async beginBlockPhase(
    sessionId: string,
    deadline: Date,
    executor: QueryExecutor = db
  ): Promise<RankedDraftSession> {
    const { rows } = await executor.query(
      `UPDATE ranked_draft_sessions
       SET phase = 'block', current_picker_id = NULL, deadline_at = $2,
           updated_at = NOW()
       WHERE session_id = $1
       RETURNING ${SELECT_COLUMNS}`,
      [sessionId, deadline]
    );
    return rows[0];
  },

  /**
   * Record one player's block.
   *
   * Written with a NULL guard so a resubmission cannot overwrite a block that
   * is already in — the choice is final once made, which is what lets the
   * reveal be trusted.
   */
  async setBlock(
    sessionId: string,
    isPlayer1: boolean,
    cardVariantId: string,
    executor: QueryExecutor = db
  ): Promise<RankedDraftSession> {
    const column = isPlayer1 ? "player1_block" : "player2_block";
    const { rows } = await executor.query(
      `UPDATE ranked_draft_sessions
       SET ${column} = COALESCE(${column}, $2), updated_at = NOW()
       WHERE session_id = $1
       RETURNING ${SELECT_COLUMNS}`,
      [sessionId, cardVariantId]
    );
    return rows[0];
  },

  async appendPick(
    sessionId: string,
    isPlayer1: boolean,
    cardVariantId: string,
    nextPickerId: string | null,
    deadline: Date | null,
    executor: QueryExecutor = db,
    /** Cosmetic skin, when it differs from the drafted original. */
    chosenVariantId?: string | null
  ): Promise<RankedDraftSession> {
    const picksColumn = isPlayer1 ? "player1_picks" : "player2_picks";
    const variantsColumn = isPlayer1 ? "player1_variants" : "player2_variants";
    // The pick itself always stores the ORIGINAL id (canonical identity); the
    // skin is recorded alongside so it can never displace it.
    const { rows } = await executor.query(
      `UPDATE ranked_draft_sessions
       SET ${picksColumn} = ${picksColumn} || to_jsonb($2::text),
           ${variantsColumn} = CASE
             WHEN $5::text IS NULL THEN ${variantsColumn}
             ELSE ${variantsColumn} || jsonb_build_object($2::text, $5::text)
           END,
           pick_index = pick_index + 1,
           current_picker_id = $3,
           deadline_at = $4,
           updated_at = NOW()
       WHERE session_id = $1
       RETURNING ${SELECT_COLUMNS}`,
      [sessionId, cardVariantId, nextPickerId, deadline, chosenVariantId ?? null]
    );
    return rows[0];
  },

  async complete(
    sessionId: string,
    gameId: string,
    executor: QueryExecutor = db
  ): Promise<RankedDraftSession> {
    const { rows } = await executor.query(
      `UPDATE ranked_draft_sessions
       SET phase = 'complete', game_id = $2, current_picker_id = NULL,
           deadline_at = NULL, updated_at = NOW()
       WHERE session_id = $1
       RETURNING ${SELECT_COLUMNS}`,
      [sessionId, gameId]
    );
    return rows[0];
  },

  async abort(
    sessionId: string,
    executor: QueryExecutor = db
  ): Promise<RankedDraftSession | null> {
    const { rows } = await executor.query(
      `UPDATE ranked_draft_sessions
       SET phase = 'aborted', current_picker_id = NULL, deadline_at = NULL,
           updated_at = NOW()
       WHERE session_id = $1 AND phase IN ('ban', 'draft', 'block')
       RETURNING ${SELECT_COLUMNS}`,
      [sessionId]
    );
    return rows[0] ?? null;
  },

  /** Live sessions whose clock has expired — drives the sweeper. */
  async findExpired(
    now: Date = new Date(),
    executor: QueryExecutor = db
  ): Promise<RankedDraftSession[]> {
    const { rows } = await executor.query(
      `SELECT ${SELECT_COLUMNS} FROM ranked_draft_sessions
       WHERE phase IN ('ban', 'draft', 'block')
         AND deadline_at IS NOT NULL
         AND deadline_at <= $1
       ORDER BY deadline_at ASC
       LIMIT 100`,
      [now]
    );
    return rows;
  },
};

export default RankedDraftSessionModel;
