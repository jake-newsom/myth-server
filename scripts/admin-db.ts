/**
 * Multi-database helpers for the npm-only admin console.
 * Connection strings come from .env (never exposed to the browser).
 */
import { Pool, QueryResult, PoolClient } from "pg";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "../.env") });

export type AdminDbProfile = {
  id: string;
  label: string;
  connectionString: string;
};

function sslOptionForUrl(databaseUrl: string): boolean | { rejectUnauthorized: boolean } {
  if (
    databaseUrl.includes("render.com") ||
    databaseUrl.includes("sslmode=require") ||
    databaseUrl.includes("sslmode=prefer")
  ) {
    return { rejectUnauthorized: false };
  }
  if (process.env.NODE_ENV === "production") {
    return { rejectUnauthorized: false };
  }
  return false;
}

const poolCache = new Map<string, Pool>();

function getPool(connectionString: string): Pool {
  let p = poolCache.get(connectionString);
  if (!p) {
    p = new Pool({
      connectionString,
      ssl: sslOptionForUrl(connectionString),
    });
    p.on("error", (err: Error) => {
      console.error("Admin DB pool error", err);
    });
    poolCache.set(connectionString, p);
  }
  return p;
}

/**
 * Profiles are built from DATABASE_URL (always "default" if set) plus optional extras.
 * Set DATABASE_URL_LOCAL, DATABASE_URL_PROD, etc. for additional targets.
 * Labels: ADMIN_DB_LABEL_DEFAULT, ADMIN_DB_LABEL_LOCAL, …
 */
export function loadAdminDbProfiles(): AdminDbProfile[] {
  const out: AdminDbProfile[] = [];
  const seen = new Set<string>();

  const add = (id: string, label: string, connectionString: string | undefined) => {
    const cs = connectionString?.trim();
    if (!cs || seen.has(id)) return;
    seen.add(id);
    out.push({ id, label, connectionString: cs });
  };

  add(
    "default",
    process.env.ADMIN_DB_LABEL_DEFAULT || "Default (DATABASE_URL)",
    process.env.DATABASE_URL
  );
  add("local", process.env.ADMIN_DB_LABEL_LOCAL || "Local", process.env.DATABASE_URL_LOCAL);
  add("prod", process.env.ADMIN_DB_LABEL_PROD || "Production", process.env.DATABASE_URL_PROD);
  add(
    "production",
    process.env.ADMIN_DB_LABEL_PRODUCTION || "Production (alt)",
    process.env.DATABASE_URL_PRODUCTION
  );
  add(
    "staging",
    process.env.ADMIN_DB_LABEL_STAGING || "Staging",
    process.env.DATABASE_URL_STAGING
  );

  return out;
}

export function resolveProfileId(
  profiles: AdminDbProfile[],
  headerOrQuery: string | undefined
): AdminDbProfile {
  const fallback =
    process.env.ADMIN_DB_DEFAULT_PROFILE?.trim() ||
    (profiles[0] ? profiles[0].id : "");
  const raw = (headerOrQuery || fallback || "").trim();
  const found = profiles.find((p) => p.id === raw);
  if (!found) {
    throw new Error(
      `Unknown database profile "${raw}". Configured: ${profiles.map((p) => p.id).join(", ")}`
    );
  }
  return found;
}

export function queryForProfile(
  profile: AdminDbProfile,
  text: string,
  params?: unknown[]
): Promise<QueryResult> {
  return getPool(profile.connectionString).query(text, params);
}

export async function withTransaction(
  profile: AdminDbProfile,
  fn: (c: PoolClient) => Promise<void>
): Promise<void> {
  const pool = getPool(profile.connectionString);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await fn(client);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export function getPublicProfileList(
  profiles: AdminDbProfile[]
): { id: string; label: string }[] {
  return profiles.map(({ id, label }) => ({ id, label }));
}
