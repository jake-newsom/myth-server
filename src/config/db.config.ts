import { Pool, QueryResult, PoolClient } from "pg";
import config from "./index";
import { recordQueryMetric } from "../utils/queryMetrics";

const pool = new Pool({
  connectionString: config.databaseUrl,
  // SSL configuration for cloud databases (required for Render.com and other cloud providers)
  ssl:
    config.databaseUrl?.includes("render.com") ||
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
  // Pool sizing — cap concurrent connections (default pg max is only 10).
  // Keep headroom under Postgres' max_connections for migrations/admin tools.
  max: Number(process.env.PG_POOL_MAX) || 20,
  // Release idle clients so we don't hold connections open unnecessarily.
  idleTimeoutMillis: 30_000,
  // Fail fast if the pool is exhausted instead of queueing forever.
  connectionTimeoutMillis: 5_000,
  // Kill runaway queries so a single slow query can't pin a connection.
  statement_timeout: 15_000,
  query_timeout: 15_000,
});

pool.on("error", (err: Error) => {
  console.error("Unexpected error on idle client", err);
  process.exit(-1);
});

/** Minimal interface satisfied by both the db wrapper and a raw PoolClient. */
export type QueryExecutor = {
  query: (text: string, params?: any[]) => Promise<QueryResult>;
};

export { PoolClient };

export default {
  query: async (text: string, params?: any[]): Promise<QueryResult> => {
    const started = process.hrtime.bigint();
    try {
      return await pool.query(text, params);
    } finally {
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      recordQueryMetric(elapsedMs);
    }
  },
  getClient: async (): Promise<PoolClient> => {
    const client = await pool.connect();
    const originalQuery: any = client.query.bind(client);
    client.query = (async (...args: any[]) => {
      const started = process.hrtime.bigint();
      try {
        return await originalQuery(...args);
      } finally {
        const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
        recordQueryMetric(elapsedMs);
      }
    }) as typeof client.query;
    return client;
  }, // For transactions
  pool, // Export pool if needed directly elsewhere
};
