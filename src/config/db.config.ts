import { Pool, QueryResult } from "pg";
import config from "./index";

const pool = new Pool({
  connectionString: config.databaseUrl,
  // SSL configuration for production (required for Render.com and other cloud providers)
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

pool.on("error", (err: Error) => {
  console.error("Unexpected error on idle client", err);
  process.exit(-1);
});

export default {
  query: (text: string, params?: any[]): Promise<QueryResult> =>
    pool.query(text, params),
  getClient: () => pool.connect(), // For transactions
  pool, // Export pool if needed directly elsewhere
};
