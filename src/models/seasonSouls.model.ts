import db from "../config/db.config";

export interface SeasonMythologyChoiceRow {
  user_id: string;
  season_id: string;
  set_id: string;
  locked_at: Date;
}

export interface SeasonStandingRow {
  set_id: string;
  set_name: string;
  image_url: string | null;
  souls_total: number;
  placement: number;
}

export interface SeasonUserStandingRow {
  user_id: string;
  username: string;
  souls_total: number;
  rank: number;
  total_players: number;
}

export interface SeasonUserLeaderboardPage {
  entries: SeasonUserStandingRow[];
  total_players: number;
}

export interface SeasonRewardStatusRow {
  season_id: string;
  status: "pending" | "sent" | "claimed" | "failed";
  bundle_json: Record<string, any>;
  mail_id: string | null;
  updated_at: Date;
}

const SeasonSoulsModel = {
  async getChoice(
    userId: string,
    seasonId: string
  ): Promise<SeasonMythologyChoiceRow | null> {
    const query = `
      SELECT user_id, season_id, set_id, locked_at
      FROM season_mythology_choices
      WHERE user_id = $1 AND season_id = $2
      LIMIT 1;
    `;
    const { rows } = await db.query(query, [userId, seasonId]);
    return (rows[0] as SeasonMythologyChoiceRow) || null;
  },

  async createChoice(
    userId: string,
    seasonId: string,
    setId: string
  ): Promise<SeasonMythologyChoiceRow | null> {
    const query = `
      INSERT INTO season_mythology_choices (user_id, season_id, set_id, locked_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (user_id, season_id) DO NOTHING
      RETURNING user_id, season_id, set_id, locked_at;
    `;
    const { rows } = await db.query(query, [userId, seasonId, setId]);
    return (rows[0] as SeasonMythologyChoiceRow) || null;
  },

  async getChoicesForUsers(
    seasonId: string,
    userIds: string[]
  ): Promise<Array<{ user_id: string; set_id: string }>> {
    if (userIds.length === 0) {
      return [];
    }

    const query = `
      SELECT user_id, set_id
      FROM season_mythology_choices
      WHERE season_id = $1 AND user_id = ANY($2::uuid[]);
    `;
    const { rows } = await db.query(query, [seasonId, userIds]);
    return rows as Array<{ user_id: string; set_id: string }>;
  },

  async upsertSoulContributions(
    seasonId: string,
    rows: Array<{ userId: string; setId: string; souls: number }>
  ): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    const client = await db.getClient();
    try {
      await client.query("BEGIN");

      const userIds = rows.map((row) => row.userId);
      const setIds = rows.map((row) => row.setId);
      const seasonIds = rows.map(() => seasonId);
      const souls = rows.map((row) => row.souls);

      await client.query(
        `
          INSERT INTO season_soul_contributions (season_id, user_id, set_id, souls_total, updated_at)
          SELECT season_id, user_id, set_id, souls_total, NOW()
          FROM UNNEST($1::text[], $2::uuid[], $3::uuid[], $4::bigint[]) AS t(season_id, user_id, set_id, souls_total)
          ON CONFLICT (season_id, user_id, set_id)
          DO UPDATE
          SET
            souls_total = season_soul_contributions.souls_total + EXCLUDED.souls_total,
            updated_at = NOW();
        `,
        [seasonIds, userIds, setIds, souls]
      );

      const setTotals = new Map<string, number>();
      for (const row of rows) {
        setTotals.set(row.setId, (setTotals.get(row.setId) || 0) + row.souls);
      }

      const totalSetIds = Array.from(setTotals.keys());
      const totalSeasonIds = totalSetIds.map(() => seasonId);
      const totalSouls = totalSetIds.map((setId) => setTotals.get(setId) || 0);

      await client.query(
        `
          INSERT INTO season_mythology_totals (season_id, set_id, souls_total, updated_at)
          SELECT season_id, set_id, souls_total, NOW()
          FROM UNNEST($1::text[], $2::uuid[], $3::bigint[]) AS t(season_id, set_id, souls_total)
          ON CONFLICT (season_id, set_id)
          DO UPDATE
          SET
            souls_total = season_mythology_totals.souls_total + EXCLUDED.souls_total,
            updated_at = NOW();
        `,
        [totalSeasonIds, totalSetIds, totalSouls]
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async getSeasonStandings(seasonId: string): Promise<SeasonStandingRow[]> {
    const query = `
      SELECT
        s.set_id,
        s.name AS set_name,
        s.image_url,
        COALESCE(t.souls_total, 0)::bigint AS souls_total,
        ROW_NUMBER() OVER (ORDER BY COALESCE(t.souls_total, 0) DESC, s.name ASC) AS placement
      FROM sets s
      LEFT JOIN season_mythology_totals t
        ON t.set_id = s.set_id AND t.season_id = $1
      WHERE s.is_released = true
      ORDER BY placement ASC;
    `;

    const { rows } = await db.query(query, [seasonId]);
    return rows.map((row) => ({
      set_id: row.set_id,
      set_name: row.set_name,
      image_url: row.image_url,
      souls_total: Number(row.souls_total || 0),
      placement: Number(row.placement || 0),
    }));
  },

  async getUserSeasonStats(
    userId: string,
    seasonId: string
  ): Promise<{
    choice: SeasonMythologyChoiceRow | null;
    soulsTotal: number;
    rank: number | null;
    totalPlayers: number;
  }> {
    const choice = await this.getChoice(userId, seasonId);
    if (!choice) {
      return {
        choice: null,
        soulsTotal: 0,
        rank: null,
        totalPlayers: 0,
      };
    }

    const query = `
      WITH ranked AS (
        SELECT
          c.user_id,
          c.souls_total,
          ROW_NUMBER() OVER (ORDER BY c.souls_total DESC, c.updated_at ASC) AS rank,
          COUNT(*) OVER () AS total_players
        FROM season_soul_contributions c
        WHERE c.season_id = $1
          AND c.set_id = $2
      )
      SELECT user_id, souls_total, rank, total_players
      FROM ranked
      WHERE user_id = $3
      LIMIT 1;
    `;

    const { rows } = await db.query(query, [seasonId, choice.set_id, userId]);
    const row = rows[0];

    return {
      choice,
      soulsTotal: Number(row?.souls_total || 0),
      rank: row?.rank ? Number(row.rank) : null,
      totalPlayers: Number(row?.total_players || 0),
    };
  },

  async getTopContributorsForSet(
    seasonId: string,
    setId: string,
    limit: number = 25
  ): Promise<SeasonUserStandingRow[]> {
    const query = `
      WITH ranked AS (
        SELECT
          c.user_id,
          u.username,
          c.souls_total,
          ROW_NUMBER() OVER (ORDER BY c.souls_total DESC, c.updated_at ASC) AS rank,
          COUNT(*) OVER () AS total_players
        FROM season_soul_contributions c
        INNER JOIN users u ON u.user_id = c.user_id
        WHERE c.season_id = $1
          AND c.set_id = $2
      )
      SELECT user_id, username, souls_total, rank, total_players
      FROM ranked
      ORDER BY rank ASC
      LIMIT $3;
    `;

    const { rows } = await db.query(query, [seasonId, setId, limit]);
    return rows.map((row) => ({
      user_id: row.user_id,
      username: row.username,
      souls_total: Number(row.souls_total || 0),
      rank: Number(row.rank || 0),
      total_players: Number(row.total_players || 0),
    }));
  },

  async getContributorsForSetPaginated(
    seasonId: string,
    setId: string,
    page: number,
    limit: number
  ): Promise<SeasonUserLeaderboardPage> {
    const offset = (page - 1) * limit;

    const countQuery = `
      SELECT COUNT(*)::int AS total_players
      FROM season_soul_contributions
      WHERE season_id = $1 AND set_id = $2;
    `;

    const entriesQuery = `
      WITH ranked AS (
        SELECT
          c.user_id,
          u.username,
          c.souls_total,
          ROW_NUMBER() OVER (ORDER BY c.souls_total DESC, c.updated_at ASC) AS rank
        FROM season_soul_contributions c
        INNER JOIN users u ON u.user_id = c.user_id
        WHERE c.season_id = $1
          AND c.set_id = $2
      )
      SELECT user_id, username, souls_total, rank
      FROM ranked
      ORDER BY rank ASC
      LIMIT $3 OFFSET $4;
    `;

    const [{ rows: countRows }, { rows: entryRows }] = await Promise.all([
      db.query(countQuery, [seasonId, setId]),
      db.query(entriesQuery, [seasonId, setId, limit, offset]),
    ]);

    const totalPlayers = Number(countRows[0]?.total_players || 0);
    const entries = entryRows.map((row) => ({
      user_id: row.user_id,
      username: row.username,
      souls_total: Number(row.souls_total || 0),
      rank: Number(row.rank || 0),
      total_players: totalPlayers,
    }));

    return {
      entries,
      total_players: totalPlayers,
    };
  },

  async getRewardStatus(
    userId: string,
    seasonId: string
  ): Promise<SeasonRewardStatusRow | null> {
    const query = `
      SELECT season_id, status, bundle_json, mail_id, updated_at
      FROM season_reward_payouts
      WHERE user_id = $1 AND season_id = $2
      LIMIT 1;
    `;
    const { rows } = await db.query(query, [userId, seasonId]);
    return (rows[0] as SeasonRewardStatusRow) || null;
  },
};

export default SeasonSoulsModel;
