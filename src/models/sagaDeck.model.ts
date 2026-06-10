import { PoolClient } from "pg";
import db from "../config/db.config";
import { SagaCard, SagaDeck, SagaDeckWithCards } from "../types/saga.types";
import SagaCardModel from "./sagaCard.model";

const DECK_COLUMNS = `deck_id, run_id, created_at, updated_at`;

function rowToDeck(row: Record<string, unknown>): SagaDeck {
  return row as unknown as SagaDeck;
}

const SagaDeckModel = {
  async findByRunId(runId: string): Promise<SagaDeck | null> {
    const { rows } = await db.query(
      `SELECT ${DECK_COLUMNS} FROM saga_decks WHERE run_id = $1`,
      [runId]
    );
    return rows[0] ? rowToDeck(rows[0]) : null;
  },

  async findById(deckId: string): Promise<SagaDeck | null> {
    const { rows } = await db.query(
      `SELECT ${DECK_COLUMNS} FROM saga_decks WHERE deck_id = $1`,
      [deckId]
    );
    return rows[0] ? rowToDeck(rows[0]) : null;
  },

  async createWithClient(client: PoolClient, runId: string): Promise<SagaDeck> {
    const { rows } = await client.query(
      `INSERT INTO saga_decks (run_id) VALUES ($1) RETURNING ${DECK_COLUMNS}`,
      [runId]
    );
    return rowToDeck(rows[0]);
  },

  async findWithCardsByRunId(runId: string): Promise<SagaDeckWithCards | null> {
    const deck = await this.findByRunId(runId);
    if (!deck) return null;

    const cards = await SagaCardModel.findByDeckId(deck.deck_id);
    return { ...deck, cards };
  },

  async findWithActiveCardsByRunId(
    runId: string
  ): Promise<SagaDeckWithCards | null> {
    const deck = await this.findByRunId(runId);
    if (!deck) return null;

    const cards = await SagaCardModel.findActiveByRunId(runId);
    return { ...deck, cards };
  },
};

export default SagaDeckModel;
