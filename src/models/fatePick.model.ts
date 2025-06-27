import db from "../config/db.config";

interface FatePick {
  id: string;
  pack_opening_id: string;
  original_owner_id: string;
  original_cards: any[];
  set_id: string;
  cost_fate_coins: number;
  max_participants: number;
  current_participants: number;
  expires_at: Date;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

interface FatePickWithDetails extends FatePick {
  original_owner_username: string;
  set_name: string;
  can_participate: boolean;
  user_has_participated: boolean;
}

interface FatePickParticipation {
  id: string;
  fate_pick_id: string;
  participant_id: string;
  shuffled_positions: number[];
  selected_position: number | null;
  won_card: any | null;
  cost_paid: number;
  status: "shuffled" | "selected" | "expired";
  participated_at: Date;
  selected_at: Date | null;
  expires_at: Date;
}

const FatePickModel = {
  /**
   * Create a fate pick from a pack opening
   */
  async createFromPackOpening(
    packOpeningId: string,
    originalOwnerId: string,
    cards: any[],
    setId: string,
    costFateCoins: number = 1
  ): Promise<FatePick> {
    const query = `
      INSERT INTO fate_picks (
        pack_opening_id, original_owner_id, original_cards, set_id, cost_fate_coins
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
    `;

    const { rows } = await db.query(query, [
      packOpeningId,
      originalOwnerId,
      JSON.stringify(cards),
      setId,
      costFateCoins,
    ]);

    return rows[0];
  },

  /**
   * Get available fate picks for a user (excluding their own)
   */
  async getAvailableFatePicks(
    userId: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<FatePickWithDetails[]> {
    // First, get user's friends
    const friendsQuery = `
      SELECT 
        CASE 
          WHEN requester_id = $1 THEN addressee_id
          ELSE requester_id
        END as friend_id
      FROM friendships
      WHERE (requester_id = $1 OR addressee_id = $1)
        AND status = 'accepted';
    `;

    const { rows: friendRows } = await db.query(friendsQuery, [userId]);
    const friendIds = friendRows.map((row) => row.friend_id);

    // Build the main query - prioritize friends' packs, then random others
    let whereConditions = `
      wp.is_active = true 
      AND wp.expires_at > NOW() 
      AND wp.original_owner_id != $1
      AND wp.current_participants < wp.max_participants
    `;

    let orderBy = `
      CASE 
        WHEN wp.original_owner_id = ANY($2) THEN 0 
        ELSE 1 
      END,
      wp.created_at DESC
    `;

    const query = `
      SELECT 
        wp.*,
        u.username as original_owner_username,
        s.name as set_name,
        NOT EXISTS (
          SELECT 1 FROM fate_pick_participations wpp 
          WHERE wpp.fate_pick_id = wp.id AND wpp.participant_id = $1
        ) as can_participate,
        EXISTS (
          SELECT 1 FROM fate_pick_participations wpp 
          WHERE wpp.fate_pick_id = wp.id AND wpp.participant_id = $1
        ) as user_has_participated
      FROM fate_picks wp
      JOIN users u ON wp.original_owner_id = u.user_id
      JOIN sets s ON wp.set_id = s.set_id
      WHERE ${whereConditions}
      ORDER BY ${orderBy}
      LIMIT $3 OFFSET $4;
    `;

    const { rows } = await db.query(query, [
      userId,
      friendIds.length > 0 ? friendIds : [userId], // Fallback to avoid empty array
      limit,
      offset,
    ]);

    return rows.map((row) => ({
      ...row,
      original_cards: JSON.parse(row.original_cards),
      can_participate: row.can_participate,
      user_has_participated: row.user_has_participated,
    }));
  },

  /**
   * Get wonder pick by ID with user context
   */
  async getFatePickById(
    fatePickId: string,
    userId?: string
  ): Promise<FatePickWithDetails | null> {
    const query = `
      SELECT 
        wp.*,
        u.username as original_owner_username,
        s.name as set_name,
        ${
          userId
            ? `
          NOT EXISTS (
            SELECT 1 FROM fate_pick_participations wpp 
            WHERE wpp.fate_pick_id = wp.id AND wpp.participant_id = $2
          ) as can_participate,
          EXISTS (
            SELECT 1 FROM fate_pick_participations wpp 
            WHERE wpp.fate_pick_id = wp.id AND wpp.participant_id = $2
          ) as user_has_participated
        `
            : `
          true as can_participate,
          false as user_has_participated
        `
        }
      FROM fate_picks wp
      JOIN users u ON wp.original_owner_id = u.user_id
      JOIN sets s ON wp.set_id = s.set_id
      WHERE wp.id = $1;
    `;

    const params = userId ? [fatePickId, userId] : [fatePickId];
    const { rows } = await db.query(query, params);

    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      ...row,
      original_cards: JSON.parse(row.original_cards),
      can_participate: row.can_participate,
      user_has_participated: row.user_has_participated,
    };
  },

  /**
   * Create a participation (shuffle cards for a user)
   */
  async createParticipation(
    fatePickId: string,
    participantId: string,
    costPaid: number
  ): Promise<FatePickParticipation> {
    // Generate a random shuffle of positions [0, 1, 2, 3, 4]
    const positions = [0, 1, 2, 3, 4];
    for (let i = positions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [positions[i], positions[j]] = [positions[j], positions[i]];
    }

    const query = `
      INSERT INTO fate_pick_participations (
        fate_pick_id, participant_id, shuffled_positions, cost_paid
      ) VALUES ($1, $2, $3, $4)
      RETURNING *;
    `;

    const { rows } = await db.query(query, [
      fatePickId,
      participantId,
      JSON.stringify(positions),
      costPaid,
    ]);

    return {
      ...rows[0],
      shuffled_positions: JSON.parse(rows[0].shuffled_positions),
      won_card: rows[0].won_card ? JSON.parse(rows[0].won_card) : null,
    };
  },

  /**
   * Select a card position and reveal the result
   */
  async selectCardPosition(
    participationId: string,
    selectedPosition: number
  ): Promise<{ participation: FatePickParticipation; wonCard: any }> {
    // First get the participation and wonder pick details
    const getParticipationQuery = `
      SELECT 
        wpp.*,
        wp.original_cards
      FROM fate_pick_participations wpp
      JOIN fate_picks wp ON wpp.fate_pick_id = wp.id
      WHERE wpp.id = $1 AND wpp.status = 'shuffled';
    `;

    const { rows: participationRows } = await db.query(getParticipationQuery, [
      participationId,
    ]);

    if (participationRows.length === 0) {
      throw new Error("Participation not found or already completed");
    }

    const participation = participationRows[0];
    const shuffledPositions = JSON.parse(participation.shuffled_positions);
    const originalCards = JSON.parse(participation.original_cards);

    // Get the actual card at the selected position
    const actualCardIndex = shuffledPositions[selectedPosition];
    const wonCard = originalCards[actualCardIndex];

    // Update the participation with the selection
    const updateQuery = `
      UPDATE fate_pick_participations 
      SET 
        selected_position = $1,
        won_card = $2,
        status = 'selected',
        selected_at = NOW()
      WHERE id = $3
      RETURNING *;
    `;

    const { rows } = await db.query(updateQuery, [
      selectedPosition,
      JSON.stringify(wonCard),
      participationId,
    ]);

    return {
      participation: {
        ...rows[0],
        shuffled_positions: JSON.parse(rows[0].shuffled_positions),
        won_card: JSON.parse(rows[0].won_card),
      },
      wonCard,
    };
  },

  /**
   * Get user's participation for a wonder pick
   */
  async getUserParticipation(
    fatePickId: string,
    userId: string
  ): Promise<FatePickParticipation | null> {
    const query = `
      SELECT * FROM fate_pick_participations
      WHERE fate_pick_id = $1 AND participant_id = $2;
    `;

    const { rows } = await db.query(query, [fatePickId, userId]);

    if (rows.length === 0) return null;

    return {
      ...rows[0],
      shuffled_positions: JSON.parse(rows[0].shuffled_positions),
      won_card: rows[0].won_card ? JSON.parse(rows[0].won_card) : null,
    };
  },

  /**
   * Get user's participation history
   */
  async getUserParticipationHistory(
    userId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<
    Array<FatePickParticipation & { fate_pick: FatePickWithDetails }>
  > {
    const query = `
      SELECT 
        wpp.*,
        wp.*,
        u.username as original_owner_username,
        s.name as set_name
      FROM fate_pick_participations wpp
      JOIN fate_picks wp ON wpp.fate_pick_id = wp.id
      JOIN users u ON wp.original_owner_id = u.user_id
      JOIN sets s ON wp.set_id = s.set_id
      WHERE wpp.participant_id = $1
      ORDER BY wpp.participated_at DESC
      LIMIT $2 OFFSET $3;
    `;

    const { rows } = await db.query(query, [userId, limit, offset]);

    return rows.map((row) => ({
      id: row.id,
      fate_pick_id: row.fate_pick_id,
      participant_id: row.participant_id,
      shuffled_positions: JSON.parse(row.shuffled_positions),
      selected_position: row.selected_position,
      won_card: row.won_card ? JSON.parse(row.won_card) : null,
      cost_paid: row.cost_paid,
      status: row.status,
      participated_at: row.participated_at,
      selected_at: row.selected_at,
      expires_at: row.expires_at,
      fate_pick: {
        id: row.fate_pick_id,
        pack_opening_id: row.pack_opening_id,
        original_owner_id: row.original_owner_id,
        original_cards: JSON.parse(row.original_cards),
        set_id: row.set_id,
        cost_fate_coins: row.cost_fate_coins,
        max_participants: row.max_participants,
        current_participants: row.current_participants,
        expires_at: row.expires_at,
        is_active: row.is_active,
        created_at: row.created_at,
        updated_at: row.updated_at,
        original_owner_username: row.original_owner_username,
        set_name: row.set_name,
        can_participate: false,
        user_has_participated: true,
      },
    }));
  },

  /**
   * Clean up expired wonder picks and participations
   */
  async cleanupExpired(): Promise<{
    expiredPicks: number;
    expiredParticipations: number;
  }> {
    await db.query("SELECT cleanup_expired_fate_picks();");

    // Get counts of what was cleaned up
    const expiredPicksQuery = `
      SELECT COUNT(*) as count FROM fate_picks 
      WHERE is_active = false AND expires_at < NOW();
    `;

    const expiredParticipationsQuery = `
      SELECT COUNT(*) as count FROM fate_pick_participations 
      WHERE status = 'expired';
    `;

    const [picksResult, participationsResult] = await Promise.all([
      db.query(expiredPicksQuery),
      db.query(expiredParticipationsQuery),
    ]);

    return {
      expiredPicks: parseInt(picksResult.rows[0].count),
      expiredParticipations: parseInt(participationsResult.rows[0].count),
    };
  },

  /**
   * Get wonder pick statistics
   */
  async getFatePickStats(): Promise<{
    total_active_picks: number;
    total_participations_today: number;
    average_participants_per_pick: number;
    most_popular_set: string | null;
  }> {
    const query = `
      WITH stats AS (
        SELECT 
          COUNT(CASE WHEN wp.is_active = true AND wp.expires_at > NOW() THEN 1 END) as active_picks,
          COUNT(CASE WHEN wpp.participated_at >= NOW() - INTERVAL '24 hours' THEN 1 END) as participations_today,
          AVG(wp.current_participants) as avg_participants
        FROM fate_picks wp
        LEFT JOIN fate_pick_participations wpp ON wp.id = wpp.fate_pick_id
      ),
      popular_set AS (
        SELECT s.name as set_name
        FROM fate_picks wp
        JOIN sets s ON wp.set_id = s.set_id
        WHERE wp.created_at >= NOW() - INTERVAL '7 days'
        GROUP BY s.name
        ORDER BY COUNT(*) DESC
        LIMIT 1
      )
      SELECT 
        stats.active_picks as total_active_picks,
        stats.participations_today as total_participations_today,
        COALESCE(stats.avg_participants, 0) as average_participants_per_pick,
        popular_set.set_name as most_popular_set
      FROM stats
      LEFT JOIN popular_set ON true;
    `;

    const { rows } = await db.query(query);
    const result = rows[0];

    return {
      total_active_picks: parseInt(result.total_active_picks),
      total_participations_today: parseInt(result.total_participations_today),
      average_participants_per_pick: parseFloat(
        result.average_participants_per_pick
      ),
      most_popular_set: result.most_popular_set,
    };
  },
};

export default FatePickModel;
export { FatePick, FatePickWithDetails, FatePickParticipation };
