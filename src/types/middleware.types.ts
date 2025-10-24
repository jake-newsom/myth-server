import { Request } from "express";

/**
 * Middleware-specific type definitions
 * Consolidated from various middleware and controller files
 */

// Authentication middleware types
export interface AuthenticatedRequest extends Request {
  user?: {
    user_id: string;
    username: string;
    email: string;
  };
  sessionId?: string;
}

// Error handling types
export interface ErrorResponse {
  error: {
    message: string;
    statusCode: number;
    code?: string;
  };
}

export interface ErrorResponseObject {
  message: string;
  statusCode: number;
  timestamp: string;
  path: string;
}

// Rate limiting types
export interface RateLimitRecord {
  count: number;
  resetTime: number;
}

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}
