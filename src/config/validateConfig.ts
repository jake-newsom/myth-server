type Env = Record<string, string | undefined>;

const isPositiveInt = (value: string) => /^[1-9]\d*$/.test(value);

/**
 * Fails boot on config the server can't run with. Only names variables, never
 * their values. Optional features (Redis, social login, Gemini) stay optional:
 * Redis is reported as a warning since the cache runs without it.
 */
export function validateConfig(env: Env = process.env): void {
  const problems: string[] = [];

  if (!env.DATABASE_URL) problems.push("DATABASE_URL is required");
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
    problems.push("JWT_SECRET is required and must be at least 32 characters");
  }
  if (env.BCRYPT_SALT_ROUNDS && !isPositiveInt(env.BCRYPT_SALT_ROUNDS)) {
    problems.push("BCRYPT_SALT_ROUNDS must be a positive integer");
  }
  if (env.PORT && !isPositiveInt(env.PORT)) {
    problems.push("PORT must be a positive integer");
  }
  if (env.REDIS_PORT && !isPositiveInt(env.REDIS_PORT)) {
    problems.push("REDIS_PORT must be a positive integer");
  }

  if (problems.length > 0) {
    throw new Error(`Invalid server configuration:\n- ${problems.join("\n- ")}`);
  }

  if (env.NODE_ENV === "production" && (!env.REDIS_HOST || !env.REDIS_PASSWORD)) {
    console.warn("REDIS_HOST/REDIS_PASSWORD not set; running without the Redis cache");
  }
}
