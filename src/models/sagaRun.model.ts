import { PoolClient } from "pg";
import db from "../config/db.config";
import {
  CreateSagaRunInput,
  SagaDraftState,
  SagaRun,
  SagaRunStatus,
  UpdateSagaRunInput,
} from "../types/saga.types";

const RUN_COLUMNS = `
  run_id, player_id, season_id, status, current_floor, current_node, node_map,
  currency_earned, run_currency, attempt_count, completed_at, draft_state,
  pending_node_reward, created_at, updated_at
`;

function rowToRun(row: Record<string, unknown>): SagaRun {
  return row as unknown as SagaRun;
}

const SagaRunModel = {
  async findById(runId: string): Promise<SagaRun | null> {
    const { rows } = await db.query(
      `SELECT ${RUN_COLUMNS} FROM saga_runs WHERE run_id = $1`,
      [runId]
    );
    return rows[0] ? rowToRun(rows[0]) : null;
  },

  async findActiveByPlayerAndSeason(
    playerId: string,
    seasonId: string
  ): Promise<SagaRun | null> {
    const { rows } = await db.query(
      `SELECT ${RUN_COLUMNS}
       FROM saga_runs
       WHERE player_id = $1 AND season_id = $2 AND status = 'active'
       LIMIT 1`,
      [playerId, seasonId]
    );
    return rows[0] ? rowToRun(rows[0]) : null;
  },

  async findByPlayerId(
    playerId: string,
    options?: { seasonId?: string; status?: SagaRunStatus }
  ): Promise<SagaRun[]> {
    const conditions = ["player_id = $1"];
    const values: unknown[] = [playerId];
    let paramIndex = 2;

    if (options?.seasonId) {
      conditions.push(`season_id = $${paramIndex++}`);
      values.push(options.seasonId);
    }
    if (options?.status) {
      conditions.push(`status = $${paramIndex++}`);
      values.push(options.status);
    }

    const { rows } = await db.query(
      `SELECT ${RUN_COLUMNS}
       FROM saga_runs
       WHERE ${conditions.join(" AND ")}
       ORDER BY
        CASE status WHEN 'active' THEN 0 WHEN 'completed' THEN 1 ELSE 2 END,
        COALESCE(completed_at, created_at) DESC`,
      values
    );
    return rows.map(rowToRun);
  },

  async findLatestCompletedByPlayerAndSeason(
    playerId: string,
    seasonId: string
  ): Promise<SagaRun | null> {
    const { rows } = await db.query(
      `SELECT ${RUN_COLUMNS}
       FROM saga_runs
       WHERE player_id = $1 AND season_id = $2 AND status = 'completed'
       ORDER BY completed_at DESC NULLS LAST, created_at DESC
       LIMIT 1`,
      [playerId, seasonId]
    );
    return rows[0] ? rowToRun(rows[0]) : null;
  },

  async createWithClient(
    client: PoolClient,
    playerId: string,
    input: CreateSagaRunInput
  ): Promise<SagaRun> {
    const { rows } = await client.query(
      `INSERT INTO saga_runs (player_id, season_id, node_map)
       VALUES ($1, $2, $3)
       RETURNING ${RUN_COLUMNS}`,
      [playerId, input.season_id, JSON.stringify(input.node_map ?? {})]
    );
    return rowToRun(rows[0]);
  },

  async update(
    runId: string,
    input: UpdateSagaRunInput,
    client: PoolClient | typeof db = db
  ): Promise<SagaRun | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    const assign = (column: string, value: unknown) => {
      fields.push(`${column} = $${paramIndex++}`);
      values.push(value);
    };

    if (input.status !== undefined) assign("status", input.status);
    if (input.current_floor !== undefined) {
      assign("current_floor", input.current_floor);
    }
    if (input.current_node !== undefined) {
      assign("current_node", input.current_node);
    }
    if (input.node_map !== undefined) {
      assign("node_map", JSON.stringify(input.node_map));
    }
    if (input.currency_earned !== undefined) {
      assign("currency_earned", input.currency_earned);
    }
    if (input.run_currency !== undefined) {
      assign("run_currency", input.run_currency);
    }
    if (input.attempt_count !== undefined) {
      assign("attempt_count", input.attempt_count);
    }
    if (input.completed_at !== undefined) {
      assign("completed_at", input.completed_at);
    }
    if (input.draft_state !== undefined) {
      assign(
        "draft_state",
        input.draft_state === null ? null : JSON.stringify(input.draft_state)
      );
    }
    if (input.pending_node_reward !== undefined) {
      assign(
        "pending_node_reward",
        input.pending_node_reward === null
          ? null
          : JSON.stringify(input.pending_node_reward)
      );
    }

    if (fields.length === 0) {
      return this.findById(runId);
    }

    fields.push("updated_at = NOW()");
    values.push(runId);

    const { rows } = await client.query(
      `UPDATE saga_runs SET ${fields.join(", ")}
       WHERE run_id = $${paramIndex}
       RETURNING ${RUN_COLUMNS}`,
      values
    );
    return rows[0] ? rowToRun(rows[0]) : null;
  },

  async delete(runId: string): Promise<boolean> {
    const { rowCount } = await db.query(
      `DELETE FROM saga_runs WHERE run_id = $1`,
      [runId]
    );
    return (rowCount ?? 0) > 0;
  },
};

export default SagaRunModel;
