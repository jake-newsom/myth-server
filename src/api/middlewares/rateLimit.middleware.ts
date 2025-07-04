import { Request, Response, NextFunction } from "express";
import { RateLimitError } from "./errorHandler.middleware";

// In-memory rate limiting store (for production, consider Redis)
interface RateLimitRecord {
  requests: number;
  resetTime: number;
  firstRequest: number;
}

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
  message?: string;
  skipSuccessfulRequests?: boolean; // Don't count successful requests
  skipFailedRequests?: boolean; // Don't count failed requests
}

class RateLimitStore {
  private store: Map<string, RateLimitRecord> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Clean up expired records every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.store.entries()) {
      if (now > record.resetTime) {
        this.store.delete(key);
      }
    }
  }

  hit(key: string, windowMs: number): RateLimitRecord {
    const now = Date.now();
    const record = this.store.get(key);

    if (!record || now > record.resetTime) {
      // First request or window expired
      const newRecord: RateLimitRecord = {
        requests: 1,
        resetTime: now + windowMs,
        firstRequest: now,
      };
      this.store.set(key, newRecord);
      return newRecord;
    }

    // Increment existing record
    record.requests++;
    this.store.set(key, record);
    return record;
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.store.clear();
  }
}

// Global rate limit store instance
const globalStore = new RateLimitStore();

// Rate limiting middleware factory
export const createRateLimit = (config: RateLimitConfig) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Generate key based on user ID and IP
    const userId = req.user?.user_id;
    const ip = req.ip || req.connection.remoteAddress || "unknown";
    const key = userId ? `user:${userId}` : `ip:${ip}`;

    // Check rate limit
    const record = globalStore.hit(key, config.windowMs);

    // Set rate limit headers
    res.set({
      "X-RateLimit-Limit": config.maxRequests.toString(),
      "X-RateLimit-Remaining": Math.max(
        0,
        config.maxRequests - record.requests
      ).toString(),
      "X-RateLimit-Reset": new Date(record.resetTime).toISOString(),
      "X-RateLimit-Window": (config.windowMs / 1000).toString(),
    });

    if (record.requests > config.maxRequests) {
      const retryAfter = Math.ceil((record.resetTime - Date.now()) / 1000);
      const message =
        config.message ||
        `Too many requests. Limit: ${config.maxRequests} per ${
          config.windowMs / 1000
        } seconds`;

      throw new RateLimitError(message, retryAfter);
    }

    next();
  };
};

// Pre-configured rate limiters for common use cases

// Strict rate limiting for sensitive operations (XP transfers, pack purchases)
export const strictRateLimit = createRateLimit({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 5, // 5 requests per minute
  message: "Too many sensitive operations. Please wait before trying again.",
});

// Moderate rate limiting for API calls
export const moderateRateLimit = createRateLimit({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 120, // 120 requests per minute (2 per second average)
  message: "Too many API requests. Please slow down.",
});

// Lenient rate limiting for general endpoints
export const lenientRateLimit = createRateLimit({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 100, // 100 requests per minute
  message: "Too many requests. Please try again later.",
});

// Authentication rate limiting (prevent brute force)
export const authRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 5, // 5 attempts per 15 minutes
  message:
    "Too many authentication attempts. Please wait 15 minutes before trying again.",
});

// Pack opening rate limiting (prevent rapid pack opening)
export const packOpeningRateLimit = createRateLimit({
  windowMs: 10 * 1000, // 10 seconds
  maxRequests: 3, // 3 pack openings per 10 seconds
  message:
    "Pack opening too quickly. Please wait a moment between pack openings.",
});

// Game action rate limiting (prevent rapid game actions)
export const gameActionRateLimit = createRateLimit({
  windowMs: 10 * 1000, // 10 seconds
  maxRequests: 100, // 100 actions per 10 seconds (10 per second average)
  message: "Game actions too rapid. Please wait between actions.",
});

// AI action rate limiting (more lenient for automated AI moves)
export const aiActionRateLimit = createRateLimit({
  windowMs: 1 * 1000, // 1 second
  maxRequests: 30, // 30 AI actions per second
  message: "AI actions too rapid. Please wait between AI moves.",
});

export default {
  createRateLimit,
  strictRateLimit,
  moderateRateLimit,
  lenientRateLimit,
  authRateLimit,
  packOpeningRateLimit,
  gameActionRateLimit,
  aiActionRateLimit,
};
