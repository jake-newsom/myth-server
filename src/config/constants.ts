/**
 * Application-wide constants
 * Centralized location for magic numbers and configuration values
 */

// Game Configuration
export const GAME_CONFIG = {
  BOARD_SIZE: 4,
  MAX_CARDS_IN_HAND: 5,
  INITIAL_HAND_SIZE: 5,
} as const;

// Deck Configuration
export const DECK_CONFIG = {
  DECK_SIZE: 20,
  MAX_IDENTICAL_BASE_CARDS: 2,
  MAX_LEGENDARY_CARDS: 2,
} as const;

// XP System Configuration
export const XP_CONFIG = {
  LEVEL_THRESHOLDS: {
    LEVEL_1: 0,
    LEVEL_2: 300,
    LEVEL_3: 1000, // 300 + 700
    LEVEL_4: 2500, // 1000 + 1500
    LEVEL_5: 6000, // 2500 + 3500
  },
  MAX_LEVEL: 5,
  SACRIFICE_MULTIPLIER: 0.5, // 50% of card's XP value
} as const;

// Rarity Multipliers for XP calculation
export const RARITY_MULTIPLIERS = {
  common: 1,
  uncommon: 1.2,
  rare: 1.5,
  epic: 2,
  legendary: 3,
  "legendary+": 4,
  "legendary++": 5,
  "legendary+++": 6,
} as const;

// AI Configuration
export const AI_CONFIG = {
  PLAYER_ID: "00000000-0000-0000-0000-000000000000",
  DIFFICULTY_LEVELS: {
    EASY: "easy",
    MEDIUM: "medium",
    HARD: "hard",
  },
  MOVE_EVALUATION: {
    FLIP_BONUS: 100,
    CORNER_BONUS: 50,
    CENTER_BONUS: 25,
  },
  MOVE_SELECTION: {
    EASY_TOP_MOVES: 5,
    MEDIUM_TOP_MOVES: 3,
    HARD_TOP_MOVES: 1,
  },
} as const;

// Starter Pack Configuration
export const STARTER_CONFIG = {
  DECK_NAME: "Norse Starter Deck",
  PACKS_QUANTITY: 3,
  CARD_NAMES_AND_QUANTITIES: [
    { name: "Shieldmaiden", quantity: 2 },
    { name: "Drenger", quantity: 2 },
    { name: "Bear Totem", quantity: 2 },
    { name: "Torchbearer", quantity: 2 },
    { name: "Raven Scout", quantity: 2 },
    { name: "Ice Fisher", quantity: 2 },
    { name: "Peasant Archer", quantity: 2 },
    { name: "Norse Fox", quantity: 2 },
    { name: "Runestone Keeper", quantity: 2 },
    { name: "Young Jarl", quantity: 2 },
  ],
} as const;

// Automation Configuration
export const AUTOMATION_CONFIG = {
  AI_FATE_PICK_INTERVAL: 30 * 60 * 1000, // 30 minutes
  DAILY_REWARDS_INTERVAL: 24 * 60 * 60 * 1000, // 24 hours
  SESSION_CLEANUP_INTERVAL: 5 * 60 * 1000, // 5 minutes
  FATE_PICK_COST: 1,
  PACK_SIZE: 5,
} as const;

// Rate Limiting Configuration
export const RATE_LIMIT_CONFIG = {
  STRICT: {
    WINDOW_MS: 60 * 1000, // 1 minute
    MAX_REQUESTS: 5,
  },
  MODERATE: {
    WINDOW_MS: 60 * 1000, // 1 minute
    MAX_REQUESTS: 120,
  },
  LENIENT: {
    WINDOW_MS: 60 * 1000, // 1 minute
    MAX_REQUESTS: 100,
  },
  AUTH: {
    WINDOW_MS: 15 * 60 * 1000, // 15 minutes
    MAX_REQUESTS: 15,
  },
  PACK_OPENING: {
    WINDOW_MS: 10 * 1000, // 10 seconds
    MAX_REQUESTS: 3,
  },
  GAME_ACTION: {
    WINDOW_MS: 10 * 1000, // 10 seconds
    MAX_REQUESTS: 100,
  },
  AI_ACTION: {
    WINDOW_MS: 1 * 1000, // 1 second
    MAX_REQUESTS: 30,
  },
} as const;

// Database Configuration
export const DB_CONFIG = {
  QUERY_TIMEOUT: 30000, // 30 seconds
  CONNECTION_TIMEOUT: 5000, // 5 seconds
  MAX_CONNECTIONS: 20,
  IDLE_TIMEOUT: 30000, // 30 seconds
} as const;

// Socket Configuration
export const SOCKET_CONFIG = {
  GRACE_PERIOD_MS: 30000, // 30 seconds for reconnection
  HEARTBEAT_INTERVAL: 25000, // 25 seconds
  HEARTBEAT_TIMEOUT: 60000, // 60 seconds
} as const;

// Currency Configuration
export const CURRENCY_CONFIG = {
  STARTING_GOLD: 1000,
  STARTING_GEMS: 50,
  STARTING_FATE_COINS: 5,
  PACK_COST_GOLD: 100,
  PACK_COST_GEMS: 10,
} as const;

// Game Rewards Configuration
export const GAME_REWARDS = {
  SOLO_WIN_GOLD: 50,
  SOLO_LOSS_GOLD: 25,
  PVP_WIN_GOLD: 100,
  PVP_LOSS_GOLD: 50,
  BONUS_GOLD_PER_SECOND: 1,
  MAX_BONUS_GOLD: 200,
  XP_PER_CARD_USED: 10,
  WIN_XP_MULTIPLIER: 1.5,
} as const;

// Error Codes
export const ERROR_CODES = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  AUTHENTICATION_ERROR: "AUTHENTICATION_ERROR",
  AUTHORIZATION_ERROR: "AUTHORIZATION_ERROR",
  RATE_LIMIT_ERROR: "RATE_LIMIT_ERROR",
  INSUFFICIENT_RESOURCES: "INSUFFICIENT_RESOURCES",
  GAME_NOT_FOUND: "GAME_NOT_FOUND",
  DECK_NOT_FOUND: "DECK_NOT_FOUND",
  CARD_NOT_FOUND: "CARD_NOT_FOUND",
  DUPLICATE_RESOURCE: "DUPLICATE_RESOURCE",
  DATABASE_ERROR: "DATABASE_ERROR",
  INTERNAL_SERVER_ERROR: "INTERNAL_SERVER_ERROR",
} as const;

// HTTP Status Codes (for consistency)
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;
