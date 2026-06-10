import db from "../config/db.config";
import {
  CreateSagaSeasonInput,
  SagaSeason,
  UpdateSagaSeasonInput,
} from "../types/saga.types";

const SEASON_COLUMNS = `
  season_id, season_name, start_date, end_date,
  seasonal_mechanic, legendary_anchors, enemy_decks, boss_configs, shop_items,
  created_at, updated_at
`;

function rowToSeason(row: Record<string, unknown>): SagaSeason {
  return row as unknown as SagaSeason;
}

const SagaSeasonModel = {
  async findById(seasonId: string): Promise<SagaSeason | null> {
    const { rows } = await db.query(
      `SELECT ${SEASON_COLUMNS} FROM saga_seasons WHERE season_id = $1`,
      [seasonId]
    );
    return rows[0] ? rowToSeason(rows[0]) : null;
  },

  async findAll(limit = 50): Promise<SagaSeason[]> {
    const { rows } = await db.query(
      `SELECT ${SEASON_COLUMNS}
       FROM saga_seasons
       ORDER BY start_date DESC
       LIMIT $1`,
      [limit]
    );
    return rows.map(rowToSeason);
  },

  async findActive(now: Date = new Date()): Promise<SagaSeason | null> {
    const { rows } = await db.query(
      `SELECT ${SEASON_COLUMNS}
       FROM saga_seasons
       WHERE start_date <= $1 AND end_date > $1
       ORDER BY start_date DESC
       LIMIT 1`,
      [now]
    );
    return rows[0] ? rowToSeason(rows[0]) : null;
  },

  async create(input: CreateSagaSeasonInput): Promise<SagaSeason> {
    const { rows } = await db.query(
      `INSERT INTO saga_seasons (
        season_id, season_name, start_date, end_date,
        seasonal_mechanic, legendary_anchors, enemy_decks, boss_configs, shop_items
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING ${SEASON_COLUMNS}`,
      [
        input.season_id,
        input.season_name,
        input.start_date,
        input.end_date,
        JSON.stringify(input.seasonal_mechanic ?? {}),
        JSON.stringify(input.legendary_anchors ?? []),
        JSON.stringify(input.enemy_decks ?? {}),
        JSON.stringify(input.boss_configs ?? {}),
        JSON.stringify(input.shop_items ?? []),
      ]
    );
    return rowToSeason(rows[0]);
  },

  async update(
    seasonId: string,
    input: UpdateSagaSeasonInput
  ): Promise<SagaSeason | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    const assign = (column: string, value: unknown) => {
      fields.push(`${column} = $${paramIndex++}`);
      values.push(value);
    };

    if (input.season_name !== undefined) assign("season_name", input.season_name);
    if (input.start_date !== undefined) assign("start_date", input.start_date);
    if (input.end_date !== undefined) assign("end_date", input.end_date);
    if (input.seasonal_mechanic !== undefined) {
      assign("seasonal_mechanic", JSON.stringify(input.seasonal_mechanic));
    }
    if (input.legendary_anchors !== undefined) {
      assign("legendary_anchors", JSON.stringify(input.legendary_anchors));
    }
    if (input.enemy_decks !== undefined) {
      assign("enemy_decks", JSON.stringify(input.enemy_decks));
    }
    if (input.boss_configs !== undefined) {
      assign("boss_configs", JSON.stringify(input.boss_configs));
    }
    if (input.shop_items !== undefined) {
      assign("shop_items", JSON.stringify(input.shop_items));
    }

    if (fields.length === 0) {
      return this.findById(seasonId);
    }

    fields.push("updated_at = NOW()");
    values.push(seasonId);

    const { rows } = await db.query(
      `UPDATE saga_seasons SET ${fields.join(", ")}
       WHERE season_id = $${paramIndex}
       RETURNING ${SEASON_COLUMNS}`,
      values
    );
    return rows[0] ? rowToSeason(rows[0]) : null;
  },

  async delete(seasonId: string): Promise<boolean> {
    const { rowCount } = await db.query(
      `DELETE FROM saga_seasons WHERE season_id = $1`,
      [seasonId]
    );
    return (rowCount ?? 0) > 0;
  },
};

export default SagaSeasonModel;
