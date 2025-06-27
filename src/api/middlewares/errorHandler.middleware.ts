import { Request, Response, NextFunction } from "express";
import { GameNotFoundError } from "../../services/game.service";
import {
  DeckNotFoundError,
  DeckAccessError,
  EmptyDeckError,
} from "../../services/deck.service";

// Define custom error types
export class ValidationError extends Error {
  public field: string;
  public code: string;

  constructor(
    message: string,
    field: string,
    code: string = "VALIDATION_ERROR"
  ) {
    super(message);
    this.name = "ValidationError";
    this.field = field;
    this.code = code;
  }
}

export class AuthenticationError extends Error {
  public code: string;

  constructor(
    message: string = "Authentication required",
    code: string = "AUTH_REQUIRED"
  ) {
    super(message);
    this.name = "AuthenticationError";
    this.code = code;
  }
}

export class AuthorizationError extends Error {
  public code: string;

  constructor(
    message: string = "Access denied",
    code: string = "ACCESS_DENIED"
  ) {
    super(message);
    this.name = "AuthorizationError";
    this.code = code;
  }
}

export class RateLimitError extends Error {
  public retryAfter: number;
  public code: string;

  constructor(
    message: string = "Rate limit exceeded",
    retryAfter: number = 60,
    code: string = "RATE_LIMIT_EXCEEDED"
  ) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
    this.code = code;
  }
}

export class InsufficientResourcesError extends Error {
  public resourceType: string;
  public required: number;
  public available: number;
  public code: string;

  constructor(
    resourceType: string,
    required: number,
    available: number,
    code: string = "INSUFFICIENT_RESOURCES"
  ) {
    super(
      `Insufficient ${resourceType}. Required: ${required}, Available: ${available}`
    );
    this.name = "InsufficientResourcesError";
    this.resourceType = resourceType;
    this.required = required;
    this.available = available;
    this.code = code;
  }
}

// Enhanced error response interface
interface ErrorResponse {
  error: {
    message: string;
    code: string;
    type: string;
    details?: any;
    field?: string;
    timestamp: string;
    path: string;
    method: string;
    suggestion?: string;
  };
}

// Error handler middleware
const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  console.error(`[${new Date().toISOString()}] Error:`, {
    name: error.name,
    message: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
    user: req.user?.user_id || "anonymous",
  });

  let statusCode = 500;
  let errorResponse: ErrorResponse = {
    error: {
      message: "Internal server error",
      code: "INTERNAL_SERVER_ERROR",
      type: "ServerError",
      timestamp: new Date().toISOString(),
      path: req.path,
      method: req.method,
    },
  };

  // Handle specific error types
  if (error instanceof ValidationError) {
    statusCode = 400;
    errorResponse.error = {
      message: error.message,
      code: error.code,
      type: "ValidationError",
      field: error.field,
      timestamp: new Date().toISOString(),
      path: req.path,
      method: req.method,
      suggestion: "Please check the request parameters and try again",
    };
  } else if (error instanceof AuthenticationError) {
    statusCode = 401;
    errorResponse.error = {
      message: error.message,
      code: error.code,
      type: "AuthenticationError",
      timestamp: new Date().toISOString(),
      path: req.path,
      method: req.method,
      suggestion: "Please log in and include a valid authorization token",
    };
  } else if (error instanceof AuthorizationError) {
    statusCode = 403;
    errorResponse.error = {
      message: error.message,
      code: error.code,
      type: "AuthorizationError",
      timestamp: new Date().toISOString(),
      path: req.path,
      method: req.method,
      suggestion: "You do not have permission to access this resource",
    };
  } else if (error instanceof RateLimitError) {
    statusCode = 429;
    res.set("Retry-After", error.retryAfter.toString());
    errorResponse.error = {
      message: error.message,
      code: error.code,
      type: "RateLimitError",
      details: { retryAfter: error.retryAfter },
      timestamp: new Date().toISOString(),
      path: req.path,
      method: req.method,
      suggestion: `Please wait ${error.retryAfter} seconds before trying again`,
    };
  } else if (error instanceof InsufficientResourcesError) {
    statusCode = 400;
    errorResponse.error = {
      message: error.message,
      code: error.code,
      type: "InsufficientResourcesError",
      details: {
        resourceType: error.resourceType,
        required: error.required,
        available: error.available,
      },
      timestamp: new Date().toISOString(),
      path: req.path,
      method: req.method,
      suggestion: `You need ${error.required - error.available} more ${
        error.resourceType
      }`,
    };
  } else if (error instanceof GameNotFoundError) {
    statusCode = 404;
    errorResponse.error = {
      message: error.message,
      code: "GAME_NOT_FOUND",
      type: "NotFoundError",
      timestamp: new Date().toISOString(),
      path: req.path,
      method: req.method,
      suggestion:
        "Please check the game ID and ensure you have access to this game",
    };
  } else if (error instanceof DeckNotFoundError) {
    statusCode = 404;
    errorResponse.error = {
      message: error.message,
      code: "DECK_NOT_FOUND",
      type: "NotFoundError",
      timestamp: new Date().toISOString(),
      path: req.path,
      method: req.method,
      suggestion: "Please check the deck ID and ensure you own this deck",
    };
  } else if (error instanceof DeckAccessError) {
    statusCode = 403;
    errorResponse.error = {
      message: error.message,
      code: "DECK_ACCESS_DENIED",
      type: "AuthorizationError",
      timestamp: new Date().toISOString(),
      path: req.path,
      method: req.method,
      suggestion: "You do not have access to this deck",
    };
  } else if (error instanceof EmptyDeckError) {
    statusCode = 400;
    errorResponse.error = {
      message: error.message,
      code: "EMPTY_DECK",
      type: "ValidationError",
      timestamp: new Date().toISOString(),
      path: req.path,
      method: req.method,
      suggestion: "Please add cards to your deck before starting a game",
    };
  }

  // Handle database constraint errors
  else if (
    error.message.includes("duplicate key") ||
    error.message.includes("unique constraint")
  ) {
    statusCode = 409;
    errorResponse.error = {
      message: "Resource already exists",
      code: "DUPLICATE_RESOURCE",
      type: "ConflictError",
      details: error.message,
      timestamp: new Date().toISOString(),
      path: req.path,
      method: req.method,
      suggestion:
        "This resource already exists. Please use a different identifier",
    };
  }

  // Handle JSON parsing errors
  else if (error instanceof SyntaxError && "body" in error) {
    statusCode = 400;
    errorResponse.error = {
      message: "Invalid JSON in request body",
      code: "INVALID_JSON",
      type: "ValidationError",
      timestamp: new Date().toISOString(),
      path: req.path,
      method: req.method,
      suggestion: "Please check your JSON syntax and try again",
    };
  }

  // Handle MongoDB/PostgreSQL connection errors
  else if (
    error.message.includes("connection") ||
    error.message.includes("ECONNREFUSED")
  ) {
    statusCode = 503;
    errorResponse.error = {
      message: "Database temporarily unavailable",
      code: "DATABASE_UNAVAILABLE",
      type: "ServiceUnavailableError",
      timestamp: new Date().toISOString(),
      path: req.path,
      method: req.method,
      suggestion: "Please try again in a few moments",
    };
  }

  res.status(statusCode).json(errorResponse);
};

export default errorHandler;
