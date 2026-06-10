import { PoolClient } from "pg";
import db from "../config/db.config";
import {
  SagaCollection,
  SagaCollectionWithCards,
} from "../types/saga.types";
import SagaCardModel from "./sagaCard.model";

const COLLECTION_COLUMNS = `collection_id, run_id, created_at, updated_at`;

function rowToCollection(row: Record<string, unknown>): SagaCollection {
  return row as unknown as SagaCollection;
}

const SagaCollectionModel = {
  async findByRunId(runId: string): Promise<SagaCollection | null> {
    const { rows } = await db.query(
      `SELECT ${COLLECTION_COLUMNS} FROM saga_collections WHERE run_id = $1`,
      [runId]
    );
    return rows[0] ? rowToCollection(rows[0]) : null;
  },

  async findById(collectionId: string): Promise<SagaCollection | null> {
    const { rows } = await db.query(
      `SELECT ${COLLECTION_COLUMNS} FROM saga_collections WHERE collection_id = $1`,
      [collectionId]
    );
    return rows[0] ? rowToCollection(rows[0]) : null;
  },

  async createWithClient(
    client: PoolClient,
    runId: string
  ): Promise<SagaCollection> {
    const { rows } = await client.query(
      `INSERT INTO saga_collections (run_id) VALUES ($1) RETURNING ${COLLECTION_COLUMNS}`,
      [runId]
    );
    return rowToCollection(rows[0]);
  },

  async findWithBenchCardsByRunId(
    runId: string
  ): Promise<SagaCollectionWithCards | null> {
    const collection = await this.findByRunId(runId);
    if (!collection) return null;

    const bench_cards = await SagaCardModel.findBenchByRunId(runId);
    return { ...collection, bench_cards };
  },
};

export default SagaCollectionModel;
