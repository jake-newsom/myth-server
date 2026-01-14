import db from "../config/db.config";
import {
  UserRanking,
  UserRankingWithUser,
  GameResult,
  GameResultWithPlayers,
} from "../types/database.types";

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
    season?: string
  ): Promise<UserRanking> {
    const currentSeason = season || this.getCurrentSeason();

    // Try to get existing ranking
    const existingQuery = `
      SELECT * FROM user_rankings 
      WHERE user_id = $1 AND season = $2;
    `;
    const { rows: existing } = await db.query(existingQuery, [
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
    const { rows } = await db.query(createQuery, [userId, currentSeason]);
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
    season?: string
  ): Promise<UserRanking> {
    const currentSeason = season || this.getCurrentSeason();

    // Get or create ranking first
    await this.getOrCreateUserRanking(userId, currentSeason);

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

    const { rows } = await db.query(updateQuery, [
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

    // Get current ratings
    const [player1Ranking, player2Ranking] = await Promise.all([
      this.getOrCreateUserRanking(player1Id, currentSeason),
      this.getOrCreateUserRanking(player2Id, currentSeason),
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
        currentSeason
      ),
      this.updateUserRating(
        player2Id,
        player2Change,
        player2Wins,
        isDraw,
        currentSeason
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

    const { rows } = await db.query(insertQuery, [
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

    return rows[0];
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
        WHERE ur.season = $1
      )
      SELECT *, calculated_rank as current_rank
      FROM ranked
      ORDER BY calculated_rank
      LIMIT $2 OFFSET $3;
    `;

    const { rows } = await db.query(query, [currentSeason, limit, offset]);
    return rows;
  },

  /**
   * Get user's rank position in leaderboard
   */
  async getUserRank(userId: string, season?: string): Promise<number | null> {
    const currentSeason = season || this.getCurrentSeason();

    const query = `
      WITH ranked_users AS (
        SELECT 
          user_id,
          ROW_NUMBER() OVER (ORDER BY rating DESC, wins DESC) as rank
        FROM user_rankings
        WHERE season = $1
      )
      SELECT rank FROM ranked_users WHERE user_id = $2;
    `;

    const { rows } = await db.query(query, [currentSeason, userId]);
    return rows.length > 0 ? rows[0].rank : null;
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
      )
      SELECT *, calculated_rank as current_rank
      FROM ranked
      WHERE user_id = $1;
    `;

    const { rows } = await db.query(query, [userId, currentSeason]);
    return rows.length > 0 ? rows[0] : null;
  },

  /**
   * Get recent game results for a user
   */
  async getUserGameHistory(
    userId: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<GameResultWithPlayers[]> {
    const query = `
      SELECT 
        gr.*,
        u1.username as player1_username,
        u2.username as player2_username,
        uw.username as winner_username
      FROM game_results gr
      JOIN users u1 ON gr.player1_id = u1.user_id
      JOIN users u2 ON gr.player2_id = u2.user_id
      LEFT JOIN users uw ON gr.winner_id = uw.user_id
      WHERE gr.player1_id = $1 OR gr.player2_id = $1
      ORDER BY gr.completed_at DESC
      LIMIT $2 OFFSET $3;
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
