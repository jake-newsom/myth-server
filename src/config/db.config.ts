import { Pool, QueryResult, PoolClient } from "pg";
import config from "./index";

const pool = new Pool({
  connectionString: config.databaseUrl,
  // SSL configuration for cloud databases (required for Render.com and other cloud providers)
  ssl:
    config.databaseUrl?.includes("render.com") ||
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
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
  query: (text: string, params?: any[]): Promise<QueryResult> =>
    pool.query(text, params),
  getClient: (): Promise<PoolClient> => pool.connect(), // For transactions
  pool, // Export pool if needed directly elsewhere
};
