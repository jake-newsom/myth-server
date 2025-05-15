/**
 * Type definitions for API requests and responses
 * These will be maintained in a separate file for future packaging as an NPM module
 */

// Authentication types
export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: {
    user_id: string;
    username: string;
    email: string;
    in_game_currency: number;
  };
}

// Error response types
export interface ErrorResponse {
  error: {
    message: string;
    statusCode: number;
    code?: string;
  };
}
