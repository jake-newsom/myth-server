import { PoolClient } from "pg";
import db from "../config/db.config";
import {
  CreateSagaCardInput,
  SagaCard,
  UpdateSagaCardInput,
} from "../types/saga.types";

const CARD_COLUMNS = `
  saga_card_id, run_id, deck_id, base_card_id,
  top_buff, left_buff, right_buff, bottom_buff,
  rune_type, rune_stacks, is_active, modifier_floor, created_at, updated_at
`;

function rowToCard(row: Record<string, unknown>): SagaCard {
  return row as unknown as SagaCard;
}

const SagaCardModel = {
  async findById(sagaCardId: string): Promise<SagaCard | null> {
    const { rows } = await db.query(
      `SELECT ${CARD_COLUMNS} FROM saga_cards WHERE saga_card_id = $1`,
      [sagaCardId]
    );
    return rows[0] ? rowToCard(rows[0]) : null;
  },

  async findByRunId(runId: string): Promise<SagaCard[]> {
    const { rows } = await db.query(
      `SELECT ${CARD_COLUMNS}
       FROM saga_cards
       WHERE run_id = $1
       ORDER BY created_at ASC`,
      [runId]
    );
    return rows.map(rowToCard);
  },

  async findByDeckId(deckId: string): Promise<SagaCard[]> {
    const { rows } = await db.query(
      `SELECT ${CARD_COLUMNS}
       FROM saga_cards
       WHERE deck_id = $1 AND is_active = true
       ORDER BY created_at ASC`,
      [deckId]
    );
    return rows.map(rowToCard);
  },

  async findActiveByRunId(runId: string): Promise<SagaCard[]> {
    const { rows } = await db.query(
      `SELECT ${CARD_COLUMNS}
       FROM saga_cards
       WHERE run_id = $1 AND is_active = true
       ORDER BY created_at ASC`,
      [runId]
    );
    return rows.map(rowToCard);
  },

  async findBenchByRunId(runId: string): Promise<SagaCard[]> {
    const { rows } = await db.query(
      `SELECT ${CARD_COLUMNS}
       FROM saga_cards
       WHERE run_id = $1 AND is_active = false
       ORDER BY created_at ASC`,
      [runId]
    );
    return rows.map(rowToCard);
  },

  async create(
    runId: string,
    input: CreateSagaCardInput,
    client: PoolClient | typeof db = db
  ): Promise<SagaCard> {
    const { rows } = await client.query(
      `INSERT INTO saga_cards (
        run_id, deck_id, base_card_id,
        top_buff, left_buff, right_buff, bottom_buff,
        rune_type, rune_stacks, is_active, modifier_floor
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING ${CARD_COLUMNS}`,
      [
        runId,
        input.deck_id ?? null,
        input.base_card_id,
        input.top_buff ?? 0,
        input.left_buff ?? 0,
        input.right_buff ?? 0,
        input.bottom_buff ?? 0,
        input.rune_type ?? null,
        input.rune_stacks ?? 0,
        input.is_active ?? true,
        input.modifier_floor ?? 1,
      ]
    );
    return rowToCard(rows[0]);
  },

  async createMany(
    runId: string,
    deckId: string | null,
    cards: CreateSagaCardInput[],
    client: PoolClient
  ): Promise<SagaCard[]> {
    const created: SagaCard[] = [];
    for (const card of cards) {
      const row = await this.create(
        runId,
        { ...card, deck_id: card.deck_id ?? deckId },
        client
      );
      created.push(row);
    }
    return created;
  },

  async update(
    sagaCardId: string,
    input: UpdateSagaCardInput,
    client: PoolClient | typeof db = db
  ): Promise<SagaCard | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    const assign = (column: string, value: unknown) => {
      fields.push(`${column} = $${paramIndex++}`);
      values.push(value);
    };

    if (input.deck_id !== undefined) assign("deck_id", input.deck_id);
    if (input.top_buff !== undefined) assign("top_buff", input.top_buff);
    if (input.left_buff !== undefined) assign("left_buff", input.left_buff);
    if (input.right_buff !== undefined) assign("right_buff", input.right_buff);
    if (input.bottom_buff !== undefined) {
      assign("bottom_buff", input.bottom_buff);
    }
    if (input.rune_type !== undefined) assign("rune_type", input.rune_type);
    if (input.rune_stacks !== undefined) {
      assign("rune_stacks", input.rune_stacks);
    }
    if (input.is_active !== undefined) assign("is_active", input.is_active);
    if (input.modifier_floor !== undefined) {
      assign("modifier_floor", input.modifier_floor);
    }

    if (fields.length === 0) {
      return this.findById(sagaCardId);
    }

    fields.push("updated_at = NOW()");
    values.push(sagaCardId);

    const { rows } = await client.query(
      `UPDATE saga_cards SET ${fields.join(", ")}
       WHERE saga_card_id = $${paramIndex}
       RETURNING ${CARD_COLUMNS}`,
      values
    );
    return rows[0] ? rowToCard(rows[0]) : null;
  },

  async deleteByRunId(runId: string, client: PoolClient): Promise<void> {
    await client.query(`DELETE FROM saga_cards WHERE run_id = $1`, [runId]);
  },

  async delete(sagaCardId: string): Promise<boolean> {
    const { rowCount } = await db.query(
      `DELETE FROM saga_cards WHERE saga_card_id = $1`,
      [sagaCardId]
    );
    return (rowCount ?? 0) > 0;
  },
};

export default SagaCardModel;
