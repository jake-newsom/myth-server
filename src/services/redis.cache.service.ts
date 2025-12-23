/**
 * Redis Cache Service
 *
 * Provides a centralized caching layer using Redis with support for:
 * - Environment-based key prefixing (e.g., "prod:", "dev:")
 * - Setting cache values with TTL
 * - Purging cache values by regex pattern
 * - Clearing cache for current environment only
 *
 * All cache keys are automatically prefixed with the environment (NODE_ENV).
 * This prevents cache collisions between different environments sharing the same Redis instance.
 *
 * Usage Examples:
 * - Global cache: await redisCache.set('cards:all', data, 3600);
 *   → Stored as "prod:cards:all" or "dev:cards:all"
 * - User-specific cache: await redisCache.set(`user:${userId}:cards`, data, 1800);
 *   → Stored as "prod:user:123:cards" or "dev:user:123:cards"
 * - Purge pattern: await redisCache.purgeByPattern('user:*:cards');
 *   → Purges "prod:user:*:cards" or "dev:user:*:cards" only
 */

import { createClient, RedisClientType } from "redis";
import config from "../config";
import logger from "../utils/logger";

class RedisCacheService {
  private client: RedisClientType | null = null;
  private isConnected: boolean = false;
  private connectionPromise: Promise<void> | null = null;
  private envPrefix: string;

  constructor() {
    // Set environment prefix based on NODE_ENV
    const env = process.env.NODE_ENV || "development";
    this.envPrefix = `${env}:`;
    logger.info(`Redis cache will use prefix: ${this.envPrefix}`);
  }

  /**
   * Add environment prefix to a cache key
   * @param key - Original cache key
   * @returns Prefixed cache key (e.g., "prod:user:123")
   */
  private prefixKey(key: string): string {
    return `${this.envPrefix}${key}`;
  }

  /**
   * Initialize and connect to Redis
   */
  async connect(): Promise<void> {
    // If already connected, return immediately
    if (this.isConnected && this.client) {
      return;
    }

    // If connection is in progress, wait for it
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    // Start new connection
    this.connectionPromise = this._connect();
    return this.connectionPromise;
  }

  private async _connect(): Promise<void> {
    try {
      // Check if Redis configuration is available
      if (!config.redis.host || !config.redis.password) {
        logger.warn("Redis configuration not found. Caching will be disabled.");
        return;
      }

      this.client = createClient({
        username: config.redis.username,
        password: config.redis.password,
        socket: {
          host: config.redis.host,
          port: config.redis.port,
        },
      });

      // Set up error handler
      this.client.on("error", (err) => {
        logger.error("Redis Client Error:", err);
        this.isConnected = false;
      });

      // Set up reconnect handler
      this.client.on("reconnecting", () => {
        logger.info("Redis Client Reconnecting...");
        this.isConnected = false;
      });

      // Set up ready handler
      this.client.on("ready", () => {
        logger.info("Redis Client Ready");
        this.isConnected = true;
      });

      // Connect to Redis
      await this.client.connect();
      this.isConnected = true;
      logger.info("Successfully connected to Redis");
    } catch (error: any) {
      logger.error(
        "Failed to connect to Redis",
        undefined,
        error instanceof Error ? error : new Error(String(error))
      );
      this.client = null;
      this.isConnected = false;
      throw error;
    } finally {
      this.connectionPromise = null;
    }
  }

  /**
   * Check if Redis is available and connected
   */
  isAvailable(): boolean {
    return this.isConnected && this.client !== null;
  }

  /**
   * Set a value in cache with TTL (time to live in seconds)
   * @param key - Cache key (will be automatically prefixed with environment)
   * @param value - Value to cache (will be JSON stringified)
   * @param ttlSeconds - Time to live in seconds (default: 1 hour)
   */
  async set(key: string, value: any, ttlSeconds: number = 3600): Promise<void> {
    if (!this.isAvailable()) {
      logger.warn(`Redis not available. Skipping cache set for key: ${key}`);
      return;
    }

    try {
      const prefixedKey = this.prefixKey(key);
      const serialized = JSON.stringify(value);
      await this.client!.setEx(prefixedKey, ttlSeconds, serialized);
      logger.debug(`Cache set: ${prefixedKey} (TTL: ${ttlSeconds}s)`);
    } catch (error: any) {
      logger.error(
        `Failed to set cache for key ${key}`,
        undefined,
        error instanceof Error ? error : new Error(String(error))
      );
      // Don't throw - caching failures should not break the application
    }
  }

  /**
   * Get a value from cache
   * @param key - Cache key (will be automatically prefixed with environment)
   * @returns Parsed value or null if not found/expired
   */
  async get<T>(key: string): Promise<T | null> {
    if (!this.isAvailable()) {
      logger.warn(`Redis not available. Skipping cache get for key: ${key}`);
      return null;
    }

    try {
      const prefixedKey = this.prefixKey(key);
      const value = await this.client!.get(prefixedKey);
      if (value === null) {
        logger.debug(`Cache miss: ${prefixedKey}`);
        return null;
      }

      logger.debug(`Cache hit: ${prefixedKey}`);
      return JSON.parse(value) as T;
    } catch (error: any) {
      logger.error(`Failed to get cache for key ${key}:`, error);
      return null;
    }
  }

  /**
   * Delete a specific cache key
   * @param key - Cache key to delete (will be automatically prefixed with environment)
   */
  async delete(key: string): Promise<void> {
    if (!this.isAvailable()) {
      logger.warn(`Redis not available. Skipping cache delete for key: ${key}`);
      return;
    }

    try {
      const prefixedKey = this.prefixKey(key);
      await this.client!.del(prefixedKey);
      logger.debug(`Cache deleted: ${prefixedKey}`);
    } catch (error: any) {
      logger.error(`Failed to delete cache for key ${key}:`, error);
    }
  }

  /**
   * Purge cache entries matching a pattern (supports Redis glob-style patterns)
   * Pattern will be automatically prefixed with environment
   * Examples:
   * - 'user:*' - all keys starting with '{env}:user:' (e.g., 'prod:user:*')
   * - 'user:123:*' - all keys for user 123 in current environment
   * - '*:cards' - all keys ending with ':cards' in current environment
   *
   * @param pattern - Redis glob-style pattern (*, ?, [abc], etc.) - will be prefixed with environment
   * @returns Number of keys deleted
   */
  async purgeByPattern(pattern: string): Promise<number> {
    if (!this.isAvailable()) {
      logger.warn(
        `Redis not available. Skipping cache purge for pattern: ${pattern}`
      );
      return 0;
    }

    try {
      const prefixedPattern = this.prefixKey(pattern);
      const keys: string[] = [];

      // Use SCAN to iterate through keys matching the pattern
      // SCAN is safer than KEYS as it doesn't block the Redis server
      for await (const key of this.client!.scanIterator({
        MATCH: prefixedPattern,
        COUNT: 100, // Number of keys to scan per iteration
      })) {
        keys.push(String(key));
      }

      if (keys.length === 0) {
        logger.debug(`No keys found matching pattern: ${prefixedPattern}`);
        return 0;
      }

      // Delete all matching keys
      // Delete keys in batches to avoid issues with spreading large arrays
      let totalDeleted = 0;
      const batchSize = 100;
      for (let i = 0; i < keys.length; i += batchSize) {
        const batch = keys.slice(i, i + batchSize);
        const deleted = await this.client!.del(batch as any);
        totalDeleted += deleted;
      }

      logger.info(
        `Purged ${totalDeleted} cache entries matching pattern: ${prefixedPattern}`
      );
      return totalDeleted;
    } catch (error: any) {
      logger.error(
        `Failed to purge cache for pattern ${pattern}`,
        undefined,
        error instanceof Error ? error : new Error(String(error))
      );
      return 0;
    }
  }

  /**
   * Clear the entire cache for the current environment (use with caution!)
   * Only clears keys with the current environment prefix
   * @returns true if successful, false otherwise
   */
  async clear(): Promise<boolean> {
    if (!this.isAvailable()) {
      logger.warn("Redis not available. Skipping cache clear.");
      return false;
    }

    try {
      // Clear only keys for the current environment
      const deleted = await this.purgeByPattern("*");
      logger.warn(
        `Cleared ${deleted} cache entries for environment: ${this.envPrefix}`
      );
      return true;
    } catch (error: any) {
      logger.error("Failed to clear cache:", error);
      return false;
    }
  }

  /**
   * Get cache statistics for the current environment
   * @returns Object with cache stats or null if unavailable
   */
  async getStats(): Promise<{
    dbSize: number;
    envKeys: number;
    memoryUsed: string;
    connectedClients: number;
    environment: string;
  } | null> {
    if (!this.isAvailable()) {
      return null;
    }

    try {
      const info = await this.client!.info("memory");
      const dbSize = await this.client!.dbSize();
      const clients = await this.client!.clientList();

      // Count keys for current environment
      let envKeys = 0;
      for await (const key of this.client!.scanIterator({
        MATCH: `${this.envPrefix}*`,
        COUNT: 100,
      })) {
        envKeys++;
      }

      // Parse memory info
      const memoryMatch = info.match(/used_memory_human:([^\r\n]+)/);
      const memoryUsed = memoryMatch ? memoryMatch[1] : "unknown";

      return {
        dbSize,
        envKeys,
        memoryUsed,
        connectedClients: clients.length,
        environment: this.envPrefix.replace(":", ""),
      };
    } catch (error: any) {
      logger.error("Failed to get cache stats:", error);
      return null;
    }
  }

  /**
   * Disconnect from Redis (useful for graceful shutdown)
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
        this.isConnected = false;
        logger.info("Disconnected from Redis");
      } catch (error: any) {
        logger.error("Error disconnecting from Redis:", error);
      }
    }
  }

  /**
   * Check if a key exists in cache
   * @param key - Cache key to check (will be automatically prefixed with environment)
   * @returns true if key exists, false otherwise
   */
  async exists(key: string): Promise<boolean> {
    if (!this.isAvailable()) {
      return false;
    }

    try {
      const prefixedKey = this.prefixKey(key);
      const result = await this.client!.exists(prefixedKey);
      return result === 1;
    } catch (error: any) {
      logger.error(`Failed to check existence for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Get remaining TTL for a key
   * @param key - Cache key (will be automatically prefixed with environment)
   * @returns TTL in seconds, -1 if no expiry, -2 if key doesn't exist
   */
  async getTTL(key: string): Promise<number> {
    if (!this.isAvailable()) {
      return -2;
    }

    try {
      const prefixedKey = this.prefixKey(key);
      return await this.client!.ttl(prefixedKey);
    } catch (error: any) {
      logger.error(`Failed to get TTL for key ${key}:`, error);
      return -2;
    }
  }
}

// Export singleton instance
export const redisCache = new RedisCacheService();

// Export class for testing
export { RedisCacheService };
