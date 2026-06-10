import db from "../config/db.config";

export interface SagaPlayerSeasonRow {
  player_id: string;
  season_id: string;
  purchased_item_ids: string[];
  floor_bonuses_claimed: number[];
  full_run_bonus_claimed: boolean;
  created_at: Date;
  updated_at: Date;
}

function parseRow(row: Record<string, unknown>): SagaPlayerSeasonRow {
  const purchased = row.purchased_item_ids;
  const floors = row.floor_bonuses_claimed;
  return {
    player_id: String(row.player_id),
    season_id: String(row.season_id),
    purchased_item_ids: Array.isArray(purchased)
      ? purchased.map(String)
      : typeof purchased === "string"
        ? JSON.parse(purchased)
        : [],
    floor_bonuses_claimed: Array.isArray(floors)
      ? floors.map(Number)
      : typeof floors === "string"
        ? JSON.parse(floors)
        : [],
    full_run_bonus_claimed: Boolean(row.full_run_bonus_claimed),
    created_at: row.created_at as Date,
    updated_at: row.updated_at as Date,
  };
}

const SagaPlayerSeasonModel = {
  async find(
    playerId: string,
    seasonId: string
  ): Promise<SagaPlayerSeasonRow | null> {
    const { rows } = await db.query(
      `SELECT * FROM saga_player_seasons WHERE player_id = $1 AND season_id = $2`,
      [playerId, seasonId]
    );
    return rows.length ? parseRow(rows[0]) : null;
  },

  async getOrCreate(
    playerId: string,
    seasonId: string
  ): Promise<SagaPlayerSeasonRow> {
    const existing = await this.find(playerId, seasonId);
    if (existing) return existing;

    const { rows } = await db.query(
      `INSERT INTO saga_player_seasons (player_id, season_id)
       VALUES ($1, $2)
       ON CONFLICT (player_id, season_id) DO NOTHING
       RETURNING *`,
      [playerId, seasonId]
    );
    if (rows.length) return parseRow(rows[0]);
    const again = await this.find(playerId, seasonId);
    if (!again) throw new Error("Failed to create saga player season row");
    return again;
  },

  async update(
    playerId: string,
    seasonId: string,
    input: Partial<{
      purchased_item_ids: string[];
      floor_bonuses_claimed: number[];
      full_run_bonus_claimed: boolean;
    }>
  ): Promise<SagaPlayerSeasonRow> {
    const sets: string[] = [];
    const values: unknown[] = [playerId, seasonId];
    let idx = 3;

    if (input.purchased_item_ids !== undefined) {
      sets.push(`purchased_item_ids = $${idx++}`);
      values.push(JSON.stringify(input.purchased_item_ids));
    }
    if (input.floor_bonuses_claimed !== undefined) {
      sets.push(`floor_bonuses_claimed = $${idx++}`);
      values.push(JSON.stringify(input.floor_bonuses_claimed));
    }
    if (input.full_run_bonus_claimed !== undefined) {
      sets.push(`full_run_bonus_claimed = $${idx++}`);
      values.push(input.full_run_bonus_claimed);
    }

    sets.push("updated_at = NOW()");

    const { rows } = await db.query(
      `UPDATE saga_player_seasons SET ${sets.join(", ")}
       WHERE player_id = $1 AND season_id = $2
       RETURNING *`,
      values
    );
    if (!rows.length) {
      return this.getOrCreate(playerId, seasonId).then((row) =>
        this.update(playerId, seasonId, input)
      );
    }
    return parseRow(rows[0]);
  },
};

export default SagaPlayerSeasonModel;
