import db from "../config/db.config";
import {
  UserRanking,
  UserRankingWithUser,
  GameResult,
  GameResultWithPlayers,
} from "../types/database.types";
import { QueryExecutor } from "../config/db.config";

const LeaderboardModel = {
  /**
   * Get current season identifier
   */
  getCurrentSeason(): string {
    const now = new Date();
    const year = now.getFullYear();
    const quarter = Math.ceil((now.getMonth() + 1) / 3);
    return `${year}-Q${quarter}`;
  },

  /**
   * Get or create user ranking for current season
   */
  async getOrCreateUserRanking(
    userId: string,
    season?: string,
    queryExecutor: QueryExecutor = db
  ): Promise<UserRanking> {
    const currentSeason = season || this.getCurrentSeason();

    // Try to get existing ranking
    const existingQuery = `
      SELECT * FROM user_rankings 
      WHERE user_id = $1 AND season = $2;
    `;
    const { rows: existing } = await queryExecutor.query(existingQuery, [
      userId,
      currentSeason,
    ]);

    if (existing.length > 0) {
      return existing[0];
    }

    // Create new ranking
    const createQuery = `
      INSERT INTO user_rankings (user_id, season)
      VALUES ($1, $2)
      RETURNING *;
    `;
    const { rows } = await queryExecutor.query(createQuery, [
      userId,
      currentSeason,
    ]);
    return rows[0];
  },

  /**
   * Update user rating and stats after a game
   */
  async updateUserRating(
    userId: string,
    ratingChange: number,
    isWin: boolean,
    isDraw: boolean,
    season?: string,
    queryExecutor: QueryExecutor = db
  ): Promise<UserRanking> {
    const currentSeason = season || this.getCurrentSeason();

    // Get or create ranking first
    await this.getOrCreateUserRanking(userId, currentSeason, queryExecutor);

    const updateQuery = `
      UPDATE user_rankings 
      SET 
        rating = GREATEST(0, LEAST(3000, rating + $1)),
        wins = wins + $2,
        losses = losses + $3,
        draws = draws + $4,
        last_game_at = NOW()
      WHERE user_id = $5 AND season = $6
      RETURNING *;
    `;

    const winIncrement = isWin ? 1 : 0;
    const lossIncrement = !isWin && !isDraw ? 1 : 0;
    const drawIncrement = isDraw ? 1 : 0;

    const { rows } = await queryExecutor.query(updateQuery, [
      ratingChange,
      winIncrement,
      lossIncrement,
      drawIncrement,
      userId,
      currentSeason,
    ]);

    return rows[0];
  },

  /**
   * Calculate ELO rating change
   */
  calculateRatingChange(
    playerRating: number,
    opponentRating: number,
    isWin: boolean,
    isDraw: boolean,
    kFactor: number = 32
  ): number {
    const expectedScore =
      1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
    let actualScore = 0;

    if (isWin) actualScore = 1;
    else if (isDraw) actualScore = 0.5;
    else actualScore = 0;

    return Math.round(kFactor * (actualScore - expectedScore));
  },

  /**
   * Record game result and update both players' ratings
   */
  async recordGameResult(
    gameId: string,
    player1Id: string,
    player2Id: string,
    winnerId: string | null,
    gameMode: string,
    gameDurationSeconds: number,
    season?: string
  ): Promise<GameResult> {
    const currentSeason = season || this.getCurrentSeason();
    const client = await db.getClient();

    try {
      await client.query("BEGIN");
      // Ensure the same game_id is processed exactly once even under concurrent calls.
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext($1)::bigint);`,
        [gameId]
      );

      const existingResultQuery = `
        SELECT * FROM game_results
        WHERE game_id = $1
        LIMIT 1;
      `;
      const { rows: existingRows } = await client.query(existingResultQuery, [
        gameId,
      ]);

      if (existingRows.length > 0) {
        await client.query("COMMIT");
        return existingRows[0];
      }

      // Get current ratings
      const [player1Ranking, player2Ranking] = await Promise.all([
        this.getOrCreateUserRanking(player1Id, currentSeason, client),
        this.getOrCreateUserRanking(player2Id, currentSeason, client),
      ]);

      const player1Rating = player1Ranking.rating;
      const player2Rating = player2Ranking.rating;

      // Determine game outcome
      const isDraw = winnerId === null;
      const player1Wins = winnerId === player1Id;
      const player2Wins = winnerId === player2Id;

      // Calculate rating changes
      const player1Change = this.calculateRatingChange(
        player1Rating,
        player2Rating,
        player1Wins,
        isDraw
      );

      const player2Change = this.calculateRatingChange(
        player2Rating,
        player1Rating,
        player2Wins,
        isDraw
      );

      // Update both players' rankings
      const [updatedPlayer1, updatedPlayer2] = await Promise.all([
        this.updateUserRating(
          player1Id,
          player1Change,
          player1Wins,
          isDraw,
          currentSeason,
          client
        ),
        this.updateUserRating(
          player2Id,
          player2Change,
          player2Wins,
          isDraw,
          currentSeason,
          client
        ),
      ]);

      // Record the game result
      const insertQuery = `
      INSERT INTO game_results (
        game_id, player1_id, player2_id, winner_id, game_mode, 
        game_duration_seconds, player1_rating_before, player1_rating_after,
        player2_rating_before, player2_rating_after, rating_change, season
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *;
    `;

      const { rows } = await client.query(insertQuery, [
        gameId,
        player1Id,
        player2Id,
        winnerId,
        gameMode,
        gameDurationSeconds,
        player1Rating,
        updatedPlayer1.rating,
        player2Rating,
        updatedPlayer2.rating,
        Math.abs(player1Change), // Store absolute value of rating change
        currentSeason,
      ]);

      await client.query("COMMIT");
      return rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  /**
   * Get leaderboard for a season
   * Ranks are calculated dynamically using ROW_NUMBER() for performance
   */
  async getLeaderboard(
    season?: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<UserRankingWithUser[]> {
    const currentSeason = season || this.getCurrentSeason();

    // Calculate ranks dynamically instead of relying on stored current_rank
    // This avoids the expensive updateAllRanks operation during game completion
    // Page the rankings via an ordered (rating DESC, wins DESC) index scan and
    // LIMIT/OFFSET *before* joining users or computing rank/win_rate, so we
    // only touch one page's worth of rows. The previous form ran ROW_NUMBER()
    // over the entire season (joining every user, computing every win_rate)
    // just to return 100 rows. Rank is the offset + the page's row position,
    // which is identical to the global ROW_NUMBER() since the ordering matches.
    const query = `
      WITH page AS (
        SELECT ur.*
        FROM user_rankings ur
        WHERE ur.season = $1
          AND ur.user_id != '00000000-0000-0000-0000-000000000000'
        ORDER BY ur.rating DESC, ur.wins DESC
        LIMIT $2 OFFSET $3
      )
      SELECT
        page.*,
        u.username,
        ($3 + ROW_NUMBER() OVER (ORDER BY page.rating DESC, page.wins DESC))::int AS calculated_rank,
        ($3 + ROW_NUMBER() OVER (ORDER BY page.rating DESC, page.wins DESC))::int AS current_rank,
        (page.wins + page.losses + page.draws) as total_games,
        CASE
          WHEN (page.wins + page.losses + page.draws) > 0
          THEN ROUND((page.wins::DECIMAL / (page.wins + page.losses + page.draws) * 100), 2)
          ELSE 0
        END as win_rate
      FROM page
      JOIN users u ON page.user_id = u.user_id
      ORDER BY calculated_rank;
    `;

    const { rows } = await db.query(query, [currentSeason, limit, offset]);
    return rows;
  },

  /**
   * Get user's rank position in leaderboard
   */
  async getUserRank(userId: string, season?: string): Promise<number | null> {
    const currentSeason = season || this.getCurrentSeason();

    // Rank = (number of players ranked strictly ahead) + 1. Computing it as a
    // COUNT over a (rating, wins) tuple comparison lets Postgres use an index
    // range scan instead of ROW_NUMBER()-sorting the entire season's players
    // just to read one row's position.
    const query = `
      WITH me AS (
        SELECT rating, wins
        FROM user_rankings
        WHERE season = $1 AND user_id = $2
      )
      SELECT (
        SELECT COUNT(*) FROM user_rankings ur, me
        WHERE ur.season = $1
          AND ur.user_id != '00000000-0000-0000-0000-000000000000'
          AND (ur.rating, ur.wins) > (me.rating, me.wins)
      ) + 1 AS rank
      WHERE EXISTS (SELECT 1 FROM me);
    `;

    const { rows } = await db.query(query, [currentSeason, userId]);
    return rows.length > 0 ? Number(rows[0].rank) : null;
  },

  /**
   * Update all users' current rank positions
   */
  async updateAllRanks(season?: string): Promise<void> {
    const currentSeason = season || this.getCurrentSeason();

    const updateQuery = `
      WITH ranked_users AS (
        SELECT 
          user_id,
          ROW_NUMBER() OVER (ORDER BY rating DESC, wins DESC) as new_rank
        FROM user_rankings
        WHERE season = $1
          AND user_id != '00000000-0000-0000-0000-000000000000'
      )
      UPDATE user_rankings
      SET current_rank = ranked_users.new_rank,
          peak_rank = CASE 
            WHEN peak_rank IS NULL OR ranked_users.new_rank < peak_rank 
            THEN ranked_users.new_rank 
            ELSE peak_rank 
          END
      FROM ranked_users
      WHERE user_rankings.user_id = ranked_users.user_id 
        AND user_rankings.season = $1;
    `;

    await db.query(updateQuery, [currentSeason]);
  },

  /**
   * Get user's complete ranking info
   * Calculates rank dynamically for performance
   */
  async getUserRankingInfo(
    userId: string,
    season?: string
  ): Promise<UserRankingWithUser | null> {
    const currentSeason = season || this.getCurrentSeason();

    // Calculate rank dynamically using a window function
    const query = `
      WITH ranked AS (
        SELECT 
          ur.*,
          u.username,
          ROW_NUMBER() OVER (ORDER BY ur.rating DESC, ur.wins DESC) as calculated_rank,
          (ur.wins + ur.losses + ur.draws) as total_games,
          CASE 
            WHEN (ur.wins + ur.losses + ur.draws) > 0 
            THEN ROUND((ur.wins::DECIMAL / (ur.wins + ur.losses + ur.draws) * 100), 2)
            ELSE 0 
          END as win_rate
        FROM user_rankings ur
        JOIN users u ON ur.user_id = u.user_id
        WHERE ur.season = $2
          AND ur.user_id != '00000000-0000-0000-0000-000000000000'
      )
      SELECT *, calculated_rank as current_rank
      FROM ranked
      WHERE user_id = $1;
    `;

    const { rows } = await db.query(query, [userId, currentSeason]);
    return rows.length > 0 ? rows[0] : null;
  },

  /**
   * Batched: fetch a user's ranking rows for many seasons at once, with each
   * row's rank computed as a COUNT of players ranked ahead (index range scan)
   * rather than ROW_NUMBER()-sorting every season's full player set. Replaces
   * an N+1 over getUserRankingInfo in the rank-history endpoint.
   */
  async getUserRankingInfoForSeasons(
    userId: string,
    seasons: string[]
  ): Promise<UserRankingWithUser[]> {
    if (seasons.length === 0) return [];

    const query = `
      SELECT
        ur.*,
        u.username,
        (ur.wins + ur.losses + ur.draws) as total_games,
        CASE
          WHEN (ur.wins + ur.losses + ur.draws) > 0
          THEN ROUND((ur.wins::DECIMAL / (ur.wins + ur.losses + ur.draws) * 100), 2)
          ELSE 0
        END as win_rate,
        (
          SELECT COUNT(*) FROM user_rankings o
          WHERE o.season = ur.season
            AND o.user_id != '00000000-0000-0000-0000-000000000000'
            AND (o.rating, o.wins) > (ur.rating, ur.wins)
        )::int + 1 AS current_rank
      FROM user_rankings ur
      JOIN users u ON ur.user_id = u.user_id
      WHERE ur.user_id = $1
        AND ur.season = ANY($2::text[]);
    `;

    const { rows } = await db.query(query, [userId, seasons]);
    return rows;
  },

  /**
   * Get recent game results for a user
   */
  async getUserGameHistory(
    userId: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<GameResultWithPlayers[]> {
    // Split the player1_id/player2_id OR into a UNION ALL so each branch can
    // use its (player_id, completed_at) composite index for an ordered index
    // scan. The OR form forces a bitmap-OR + full sort that ignores those
    // indexes' ordering. Each branch fetches limit+offset rows; we merge,
    // sort, and page once, then attach usernames on the small paged set.
    const query = `
      WITH paged AS (
        SELECT * FROM (
          (
            SELECT gr.* FROM game_results gr
            WHERE gr.player1_id = $1
            ORDER BY gr.completed_at DESC
            LIMIT ($2 + $3)
          )
          UNION ALL
          (
            SELECT gr.* FROM game_results gr
            WHERE gr.player2_id = $1
            ORDER BY gr.completed_at DESC
            LIMIT ($2 + $3)
          )
        ) merged
        ORDER BY completed_at DESC
        LIMIT $2 OFFSET $3
      )
      SELECT
        gr.*,
        u1.username as player1_username,
        u2.username as player2_username,
        uw.username as winner_username
      FROM paged gr
      JOIN users u1 ON gr.player1_id = u1.user_id
      JOIN users u2 ON gr.player2_id = u2.user_id
      LEFT JOIN users uw ON gr.winner_id = uw.user_id
      ORDER BY gr.completed_at DESC;
    `;

    const { rows } = await db.query(query, [userId, limit, offset]);
    return rows;
  },

  /**
   * Get leaderboard stats
   */
  async getLeaderboardStats(season?: string): Promise<{
    total_players: number;
    total_games: number;
    average_rating: number;
    tier_distribution: Record<string, number>;
  }> {
    const currentSeason = season || this.getCurrentSeason();

    const statsQuery = `
      SELECT 
        COUNT(*) as total_players,
        AVG(rating) as average_rating,
        rank_tier,
        COUNT(*) as tier_count
      FROM user_rankings
      WHERE season = $1
        AND user_id != '00000000-0000-0000-0000-000000000000'
      GROUP BY rank_tier;
    `;

    const gamesQuery = `
      SELECT COUNT(*) as total_games
      FROM game_results
      WHERE season = $1;
    `;

    const [statsResult, gamesResult] = await Promise.all([
      db.query(statsQuery, [currentSeason]),
      db.query(gamesQuery, [currentSeason]),
    ]);

    const tierDistribution: Record<string, number> = {};
    let totalPlayers = 0;
    let averageRating = 1000;

    statsResult.rows.forEach((row) => {
      tierDistribution[row.rank_tier] = parseInt(row.tier_count);
      totalPlayers += parseInt(row.tier_count);
      if (totalPlayers === parseInt(row.tier_count)) {
        averageRating = parseFloat(row.average_rating);
      }
    });

    return {
      total_players: totalPlayers,
      total_games: parseInt(gamesResult.rows[0]?.total_games || "0"),
      average_rating: Math.round(averageRating),
      tier_distribution: tierDistribution,
    };
  },

  /**
   * Get top players in each tier
   */
  async getTopPlayersByTier(
    season?: string
  ): Promise<Record<string, UserRankingWithUser[]>> {
    const currentSeason = season || this.getCurrentSeason();

    const query = `
      WITH ranked_by_tier AS (
        SELECT 
          ur.*,
          u.username,
          (ur.wins + ur.losses + ur.draws) as total_games,
          CASE 
            WHEN (ur.wins + ur.losses + ur.draws) > 0 
            THEN ROUND((ur.wins::DECIMAL / (ur.wins + ur.losses + ur.draws) * 100), 2)
            ELSE 0 
          END as win_rate,
          ROW_NUMBER() OVER (PARTITION BY ur.rank_tier ORDER BY ur.rating DESC) as tier_rank
        FROM user_rankings ur
        JOIN users u ON ur.user_id = u.user_id
        WHERE ur.season = $1
          AND ur.user_id != '00000000-0000-0000-0000-000000000000'
      )
      SELECT * FROM ranked_by_tier 
      WHERE tier_rank <= 3
      ORDER BY rank_tier DESC, tier_rank ASC;
    `;

    const { rows } = await db.query(query, [currentSeason]);

    const tierGroups: Record<string, UserRankingWithUser[]> = {};
    rows.forEach((row) => {
      if (!tierGroups[row.rank_tier]) {
        tierGroups[row.rank_tier] = [];
      }
      tierGroups[row.rank_tier].push(row);
    });

    return tierGroups;
  },
};

export default LeaderboardModel;
