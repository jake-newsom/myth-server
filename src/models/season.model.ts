import db from "../config/db.config";

export interface SeasonDefinitionRow {
  season_id: string;
  name: string;
  start_at: Date;
  end_at: Date;
  status: "scheduled" | "active" | "finalizing" | "finalized" | "cancelled";
  generated_by: string;
  generation_rule_version: number;
  created_at: Date;
  updated_at: Date;
}

interface SeasonDateUpdateInput {
  startAt: Date;
  endAt: Date;
}

const SeasonModel = {
  async getNextSeasonId(): Promise<string> {
    const query = `
      SELECT COALESCE(MAX(season_id::bigint), 0) + 1 AS next_id
      FROM season_definitions
      WHERE season_id ~ '^[0-9]+$';
    `;
    const { rows } = await db.query(query);
    return String(rows[0]?.next_id || 1);
  },

  async upsertSeasonDefinition(input: {
    seasonId: string;
    name: string;
    startAt: Date;
    endAt: Date;
    generatedBy: string;
    generationRuleVersion?: number;
  }): Promise<SeasonDefinitionRow> {
    const query = `
      INSERT INTO season_definitions (
        season_id, name, start_at, end_at, status, generated_by, generation_rule_version, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, 'scheduled', $5, $6, NOW(), NOW())
      ON CONFLICT (season_id)
      DO UPDATE
      SET
        name = EXCLUDED.name,
        generated_by = EXCLUDED.generated_by,
        generation_rule_version = EXCLUDED.generation_rule_version,
        updated_at = NOW()
      RETURNING season_id, name, start_at, end_at, status, generated_by, generation_rule_version, created_at, updated_at;
    `;

    const { rows } = await db.query(query, [
      input.seasonId,
      input.name,
      input.startAt,
      input.endAt,
      input.generatedBy,
      input.generationRuleVersion ?? 1,
    ]);

    return rows[0] as SeasonDefinitionRow;
  },

  async listSeasons(limit: number = 20): Promise<SeasonDefinitionRow[]> {
    const query = `
      SELECT season_id, name, start_at, end_at, status, generated_by, generation_rule_version, created_at, updated_at
      FROM season_definitions
      ORDER BY start_at DESC
      LIMIT $1;
    `;
    const { rows } = await db.query(query, [limit]);
    return rows as SeasonDefinitionRow[];
  },

  async getActiveSeason(now: Date = new Date()): Promise<SeasonDefinitionRow | null> {
    const query = `
      SELECT season_id, name, start_at, end_at, status, generated_by, generation_rule_version, created_at, updated_at
      FROM season_definitions
      WHERE status IN ('scheduled', 'active', 'finalizing')
        AND start_at <= $1
        AND end_at > $1
      ORDER BY start_at DESC
      LIMIT 1;
    `;
    const { rows } = await db.query(query, [now]);
    return (rows[0] as SeasonDefinitionRow) || null;
  },

  async getNextSeason(now: Date = new Date()): Promise<SeasonDefinitionRow | null> {
    const query = `
      SELECT season_id, name, start_at, end_at, status, generated_by, generation_rule_version, created_at, updated_at
      FROM season_definitions
      WHERE status IN ('scheduled', 'active')
        AND start_at > $1
      ORDER BY start_at ASC
      LIMIT 1;
    `;
    const { rows } = await db.query(query, [now]);
    return (rows[0] as SeasonDefinitionRow) || null;
  },

  async markStatuses(now: Date = new Date()): Promise<void> {
    await db.query(
      `
        UPDATE season_definitions
        SET status = 'active', updated_at = NOW()
        WHERE status = 'scheduled'
          AND start_at <= $1
          AND end_at > $1;
      `,
      [now]
    );

    await db.query(
      `
        UPDATE season_definitions
        SET status = 'finalizing', updated_at = NOW()
        WHERE status IN ('scheduled', 'active')
          AND end_at <= $1;
      `,
      [now]
    );
  },

  async hasOverlappingWindow(
    startAt: Date,
    endAt: Date,
    excludeSeasonId?: string
  ): Promise<boolean> {
    const query = `
      SELECT 1
      FROM season_definitions
      WHERE status <> 'cancelled'
        AND ($3::text IS NULL OR season_id <> $3::text)
        AND start_at < $2
        AND end_at > $1
      LIMIT 1;
    `;

    const { rows } = await db.query(query, [startAt, endAt, excludeSeasonId ?? null]);
    return rows.length > 0;
  },

  async updateSeasonDates(
    seasonId: string,
    input: SeasonDateUpdateInput
  ): Promise<SeasonDefinitionRow | null> {
    const query = `
      UPDATE season_definitions
      SET start_at = $2, end_at = $3, generated_by = 'admin', updated_at = NOW()
      WHERE season_id = $1
      RETURNING season_id, name, start_at, end_at, status, generated_by, generation_rule_version, created_at, updated_at;
    `;
    const { rows } = await db.query(query, [seasonId, input.startAt, input.endAt]);
    return (rows[0] as SeasonDefinitionRow) || null;
  },
};

export default SeasonModel;
