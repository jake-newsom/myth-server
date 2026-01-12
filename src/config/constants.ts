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
// Uses formula: xpRequired = BASE_XP * (level - 1)^EXPONENT
// This provides faster early progression with infinite scaling
// Examples: L2=150, L3=600, L4=1350, L5=2400, L10=12150, L20=54150
export const XP_CONFIG = {
  // Formula parameters for calculating XP required to reach a level
  BASE_XP: 150, // Base XP multiplier
  EXPONENT: 1.7, // Polynomial growth exponent
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
    EDGE_BONUS: 15,
    // Ability-related scoring
    ABILITY_BASE_VALUE: 80,
    BUFF_ALLY_VALUE: 40,
    DEBUFF_ENEMY_VALUE: 35,
    DRAW_CARD_VALUE: 70,
    FLIP_ENEMY_VALUE: 120,
    BOARD_CONTROL_VALUE: 30,
    TILE_MANIPULATION_VALUE: 25,
    PROTECTION_VALUE: 60,
    // Strategic positioning
    DEFENSIVE_POSITION_BONUS: 20,
    OFFENSIVE_POSITION_BONUS: 35,
    SYNERGY_BONUS: 45,

    // Ability category multipliers
    PERMANENT_BUFF_MULTIPLIER: 2.0, // Permanent buffs worth 2x temporary
    RECURRING_EFFECT_MULTIPLIER: 1.5, // Effects that trigger multiple times
    INVINCIBILITY_MULTIPLIER: 2.5, // Extreme defensive value
    COMEBACK_MULTIPLIER: 1.8, // When behind, comeback mechanics boosted
    SCALING_ABILITY_MULTIPLIER: 1.4, // Abilities that grow over time

    // Game phase multipliers
    EARLY_GAME_DRAW_MULTIPLIER: 1.5, // Card draw more valuable early
    EARLY_GAME_TERRAIN_MULTIPLIER: 1.4, // Terrain setup valuable early
    LATE_GAME_FINISHER_MULTIPLIER: 1.4, // Finisher abilities late game
    LATE_GAME_DRAW_MULTIPLIER: 0.7, // Card draw less valuable late

    // Hand-hold evaluation thresholds
    HAND_HOLD_HIGH_THRESHOLD: 100, // Skip playing if hold value above this
    HAND_HOLD_ADJUSTMENT_FACTOR: 0.5, // How much to adjust score by hold value

    // Position requirement penalties/bonuses
    POSITION_REQUIREMENT_MET_BONUS: 200, // Large bonus when requirement met
    POSITION_REQUIREMENT_FAILED_PENALTY: 300, // Large penalty when failed
    ADJACENCY_SYNERGY_BONUS: 150, // Strong synergy when adjacent requirement met
    ISOLATION_REQUIREMENT_BONUS: 180, // Isolation requirements met
    TERRAIN_REQUIREMENT_BONUS: 250, // Essential terrain requirements
  },
  MOVE_SELECTION: {
    EASY_TOP_MOVES: 5,
    MEDIUM_TOP_MOVES: 3,
    HARD_TOP_MOVES: 1,
  },
  LOOKAHEAD: {
    EASY_DEPTH: 0, // No lookahead, immediate evaluation only
    MEDIUM_DEPTH: 1, // 1 move lookahead
    HARD_DEPTH: 2, // 2 moves lookahead
    MAX_TIME_MS: 3000, // Maximum time for move calculation
  },
  DIFFICULTY_WEIGHTS: {
    EASY: {
      IMMEDIATE_FLIPS: 1.0,
      CARD_POWER: 0.8,
      ABILITY_IMPACT: 0.3,
      POSITIONAL: 0.5,
      FUTURE_POTENTIAL: 0.1,
      RANDOMNESS: 0.3, // 30% random factor
    },
    MEDIUM: {
      IMMEDIATE_FLIPS: 1.0,
      CARD_POWER: 1.0,
      ABILITY_IMPACT: 0.7,
      POSITIONAL: 0.8,
      FUTURE_POTENTIAL: 0.5,
      RANDOMNESS: 0.15, // 15% random factor
    },
    HARD: {
      IMMEDIATE_FLIPS: 1.0,
      CARD_POWER: 1.0,
      ABILITY_IMPACT: 1.0,
      POSITIONAL: 1.0,
      FUTURE_POTENTIAL: 0.9,
      RANDOMNESS: 0.05, // 5% random factor
    },
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
    MAX_REQUESTS: 30,
  },
  GAME_ACTION: {
    WINDOW_MS: 10 * 1000, // 10 seconds
    MAX_REQUESTS: 100,
  },
  AI_ACTION: {
    WINDOW_MS: 1 * 1000, // 1 second
    MAX_REQUESTS: 40,
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
  STARTING_GEMS: 50,
  STARTING_FATE_COINS: 5,
  PACK_COST_GEMS: 10,
} as const;

// User Limits Configuration
export const USER_LIMITS = {
  MAX_USERNAME_LENGTH: 32,
  MAX_CARDS: 1000,
  MAX_DECKS: 30,
} as const;

// Game Rewards Configuration
export const GAME_REWARDS = {
  XP_PER_CARD_USED: 10,
  WIN_XP_MULTIPLIER: 1.5,
} as const;

// Story Mode Configuration
export const STORY_MODE_CONFIG = {
  // Default reward values for story modes (by difficulty level 1-5)
  // Story mode rewards: gems, packs, card fragments only
  DEFAULT_REWARDS: {
    FIRST_WIN: {
      LEVEL_1: {
        gems: 5,
        packs: [{ set_id: "default", count: 1 }],
        card_fragments: 5,
      },
      LEVEL_2: {
        gems: 8,
        packs: [{ set_id: "default", count: 1 }],
        card_fragments: 8,
      },
      LEVEL_3: {
        gems: 12,
        packs: [{ set_id: "default", count: 1 }],
        card_fragments: 12,
      },
      LEVEL_4: {
        gems: 18,
        packs: [{ set_id: "default", count: 2 }],
        card_fragments: 18,
      },
      LEVEL_5: {
        gems: 25,
        packs: [{ set_id: "default", count: 2 }],
        card_fragments: 25,
      },
    },
    REPEAT_WIN: {
      LEVEL_1: { gems: 2, card_fragments: 2 },
      LEVEL_2: { gems: 3, card_fragments: 3 },
      LEVEL_3: { gems: 5, card_fragments: 5 },
      LEVEL_4: { gems: 7, card_fragments: 7 },
      LEVEL_5: { gems: 10, card_fragments: 10 },
    },
  },

  // Unlock requirements templates
  UNLOCK_TEMPLATES: {
    // No requirements - available from start (first chapter, first difficulty)
    STARTER: {},

    // Require completing previous difficulty in same chapter
    DIFFICULTY_PROGRESSION: (previousDifficultyId: string) => ({
      prerequisite_stories: [previousDifficultyId],
    }),

    // Require completing last difficulty of previous chapter
    CHAPTER_PROGRESSION: (previousChapterLastDifficultyId: string) => ({
      prerequisite_stories: [previousChapterLastDifficultyId],
    }),

    // Require user level
    LEVEL_GATED: (minLevel: number) => ({
      min_user_level: minLevel,
    }),

    // Require multiple story completions
    WIN_GATED: (minWins: number) => ({
      min_total_story_wins: minWins,
    }),

    // Complex requirements
    ADVANCED: (requirements: {
      prerequisiteStories?: string[];
      minLevel?: number;
      minWins?: number;
      requiredAchievements?: string[];
    }) => ({
      prerequisite_stories: requirements.prerequisiteStories,
      min_user_level: requirements.minLevel,
      min_total_story_wins: requirements.minWins,
      required_achievements: requirements.requiredAchievements,
    }),
  },

  // Story mode difficulty settings (by level 1-5)
  DIFFICULTY_SETTINGS: {
    LEVEL_1: {
      ai_card_level: 1,
      description: "Easy — AI uses base card stats",
      recommended_level: 1,
    },
    LEVEL_2: {
      ai_card_level: 2,
      description: "Normal — +1 to one side per card",
      recommended_level: 3,
    },
    LEVEL_3: {
      ai_card_level: 3,
      description: "Hard — +2 across two sides total",
      recommended_level: 5,
    },
    LEVEL_4: {
      ai_card_level: 4,
      description: "Expert — +3 total (one per side up to level)",
      recommended_level: 8,
    },
    LEVEL_5: {
      ai_card_level: 5,
      description: "Mythic — +4 total, optimized AI placement logic",
      recommended_level: 12,
    },
  },

  // Campaign structure
  CHAPTERS: 10,
  DIFFICULTIES_PER_CHAPTER: 5,
  TOTAL_ENTRIES: 50, // 10 chapters × 5 difficulties

  // Validation limits
  LIMITS: {
    MAX_NAME_LENGTH: 100,
    MAX_DESCRIPTION_LENGTH: 500,
    MAX_ORDER_INDEX: 999,
    MAX_REWARDS_PER_STORY: 10,
  },
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
