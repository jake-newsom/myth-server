import { Pool, QueryResult } from "pg";
import config from "./index";

const pool = new Pool({
  connectionString: config.databaseUrl,
  // Optional: SSL configuration for production if needed
  // ssl: {
  //   rejectUnauthorized: false // Necessary for some cloud providers like Heroku, Render
  // }
});

pool.on("connect", () => {
  console.log("Connected to the PostgreSQL database!");
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
