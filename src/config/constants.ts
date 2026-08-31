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
  // Total power budget a player deck may spend across its cards.
  // Must stay in sync with DECK_POWER_BUDGET in myth/src/utils/card.utils.ts.
  POWER_BUDGET: 40,
} as const;

// Ranked Draft Configuration
//
// A ranked match is drafted, not brought: players draft 11 cards from the whole
// catalog, then each removes one card from the OPPONENT's draft in the block
// phase, leaving 10 cards which are doubled into a 20-card deck. The budget is
// charged against the 11 PICKS (not the resulting cards), and it is deliberately a
// separate number from DECK_CONFIG.POWER_BUDGET — changing the unranked budget
// must never silently retune the draft format, or vice versa.
//
// Must stay in sync with RANKED_DRAFT in myth/src/utils/card.utils.ts.
export const RANKED_DRAFT_CONFIG = {
  // 11 drafted, minus 1 removed in the block phase = 10 cards in the game.
  PICKS: 11,
  // Cards taken per turn in the STEADY state. The first and last turns are
  // single picks (see pickerForIndex): P1 opens with 1 and P2 closes with 1, so
  // the 2-card blocks stay aligned and both players still land on PICKS.
  PICKS_PER_TURN: 2,
  /** Cards each player removes from the OPPONENT's deck after drafting. */
  BLOCKS_PER_PLAYER: 1,
  COPIES_PER_PICK: 2,
  POWER_BUDGET: 50,
  BANS_PER_PLAYER: 1,
  // Clocks, in milliseconds. Persisted as an absolute deadline per session so a
  // restart recovers the countdown rather than stranding a draft.
  BAN_MS: 30_000,
  /**
   * Clock for the block phase (both players choose simultaneously).
   *
   * DEBUG: temporarily 10_000_000ms (~2.8h), matching PICK_MS, so the block UI
   * can be inspected without the clock expiring. RESTORE TO 30_000 BEFORE
   * SHIPPING. Same requeue caveat as PICK_MS below — an abandoned draft sits on
   * a deadline hours away rather than being swept, so clear it with the same
   * UPDATE (add 'block' to the phase list).
   */
  BLOCK_MS: 10_000_000,
  /**
   * The planning beat after both blocks are revealed, before the game starts.
   *
   * Server-side and shared, so both players enter the game together regardless
   * of when each client rendered the reveal. Sent to the client as `revealMs`
   * so it can count the same window down.
   */
  BLOCK_REVEAL_MS: 10_000,
  // Per TURN, not per pick: one clock covers the whole PICKS_PER_TURN block, so
  // a two-card turn is a single shared thinking window rather than two. The
  // deadline is only re-armed when the turn passes to the other player.
  //
  // DEBUG: temporarily 10_000_000ms (~2.8h) so the draft UI can be worked on
  // without the clock expiring. RESTORE TO 20_000 BEFORE SHIPPING.
  //
  // Side effect to be aware of while this is set: an abandoned draft is not
  // "stuck", it is simply waiting on a deadline hours away, so the sweeper
  // correctly leaves it alone and it keeps blocking a requeue. Clear it with:
  //   UPDATE ranked_draft_sessions SET phase='aborted', deadline_at=NULL,
  //     current_picker_id=NULL WHERE phase IN ('ban','draft');
  PICK_MS: 10_000_000,
  /**
   * How long a draft survives after a player's last socket goes away.
   *
   * Not zero: a refresh, an app backgrounding, or a brief network drop all
   * look identical to quitting at the socket layer, and the client reconnects
   * and rejoins on its own. This window is what separates "gone" from
   * "blinked" — long enough to ride out a reconnect, short enough that the
   * player who stayed is not left staring at a dead draft.
   */
  DISCONNECT_GRACE_MS: 15_000,
  // Recently-drafted cards surfaced at the front of the pick grid.
  RECENT_CARDS_LIMIT: 20,
  /**
   * Ranked battles a player may start per day, gated by the
   * `ranked-draft-daily-limit` flag. Resets at 00:00 UTC ("server time"),
   * matching every other daily reset in this codebase (daily tasks, shop,
   * onboarding streaks).
   *
   * Counted against ranked_draft GAMES created today, not queue joins: a draft
   * that never produced a game cost the player nothing, so it must not cost
   * them an attempt either.
   */
  DAILY_BATTLE_LIMIT: 20,
} as const;

/**
 * Absolute age after which a ranked_draft game is treated as dead.
 *
 * A ranked draft game is bounded by construction: at most
 * PICKS * COPIES_PER_PICK cards per side, one play per turn, and a per-turn
 * clock. Even at the worst case that is well under an hour, so anything older
 * than this can only be a game whose turn clock stopped advancing (client gone,
 * process restarted mid-game, or a stalled hand-off out of the draft).
 *
 * Such a game is unreachable but still counts as "active", which permanently
 * blocks the player from queueing again — so it must be reaped, not left.
 */
export const RANKED_DRAFT_GAME_MAX_AGE_MINUTES = 60;

/** Cards a player keeps after the opponent's block: 11 drafted - 1 blocked. */
export const RANKED_DRAFT_CARDS_AFTER_BLOCK =
  RANKED_DRAFT_CONFIG.PICKS - RANKED_DRAFT_CONFIG.BLOCKS_PER_PLAYER;

// Derived: the size of the deck a completed draft produces. Asserted against
// DECK_CONFIG.DECK_SIZE at draft build time, since the engine and the client
// both assume every PvP deck is the same size.
//
// Derived from the POST-BLOCK count, not PICKS: the block phase removes one card
// per player, so drafting 11 still yields a 20-card deck.
export const RANKED_DRAFT_DECK_SIZE =
  RANKED_DRAFT_CARDS_AFTER_BLOCK * RANKED_DRAFT_CONFIG.COPIES_PER_PICK;

// Ladder namespacing for Ranked Draft.
//
// user_rankings is keyed UNIQUE(user_id, season) and `season` is an opaque
// varchar(20), so prefixing the season string gives the draft ladder a fully
// independent rating/peak/W-L-D/tier/rank with NO migration and no change to
// the existing triggers or indexes. Unranked passes no season and keeps the
// bare quarter string, so it is untouched.
//
// Defined here exactly once — never concatenate this prefix inline.
export const RANKED_DRAFT_SEASON_PREFIX = "draft-";

// user_rankings.season is varchar(20). Overflow would fail at INSERT time, so
// the helper asserts rather than letting a season silently break the ladder.
export const SEASON_COLUMN_MAX_LENGTH = 20;

// Power cost per base rarity tier, spent against DECK_CONFIG.POWER_BUDGET.
// Keyed by base rarity (strip "+" upgrade suffixes before lookup).
// Keep in sync with the client copy in myth/src/utils/card.utils.ts.
export const RARITY_POWER_COST: Record<string, number> = {
  legendary: 9,
  epic: 3,
  rare: 1,
  uncommon: 0,
  common: 0,
};

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

// Season rewards: minimum souls a player must accrue (within their chosen
// mythology) to be eligible for end-of-season reward tiers.
export const MIN_SOULS_FOR_REWARDS = 1000;

// AI Configuration
export const AI_CONFIG = {
  PLAYER_ID: "00000000-0000-0000-0000-000000000000",
  FEATURE_FLAGS: {
    ENGINE_V2_ENABLED: process.env.AI_ENGINE_V2_ENABLED !== "false",
    ENGINE_V2_SHADOW_MODE: process.env.AI_ENGINE_V2_SHADOW_MODE === "true",
  },
  TELEMETRY: {
    ENABLED: process.env.AI_TELEMETRY_ENABLED === "true",
    LOG_TOP_CANDIDATES: 3,
  },
  ROLLOUT: {
    TOWER_ONLY: process.env.AI_ENGINE_V2_TOWER_ONLY === "true",
    SHADOW_SAMPLE_RATE: Number(process.env.AI_ENGINE_V2_SHADOW_SAMPLE_RATE ?? "1"),
    MIN_EXPECTED_ELO_DELTA: 75,
  },
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
    FORMULA_COMPONENT_WEIGHTS: {
      immediate_flips: 1.0,
      expected_future_flips: 0.8,
      permanent_power_gain: 0.9,
      denial_value: 0.9,
      board_control: 0.75,
      combo_value: 0.85,
      risk: 1.0,
    },
  },
  MOVE_SELECTION: {
    EASY_TOP_MOVES: 5,
    MEDIUM_TOP_MOVES: 3,
    HARD_TOP_MOVES: 1,
    // On HARD (deterministic, top-1) the AI otherwise plays an identical line
    // against the same board, so players learn one script. When several moves
    // score within this margin of the best, treat them as tied and pick one at
    // random — this only fires when the choice is near-equal, so play strength
    // is preserved while games stop being perfectly scripted.
    TIE_MARGIN: 15,
    MAX_TIE_CANDIDATES: 4,
  },
  LOOKAHEAD: {
    EASY_DEPTH: 0, // No lookahead, immediate evaluation only
    MEDIUM_DEPTH: 2, // 2-ply search
    HARD_DEPTH: 3, // 3-ply search (iterative deepening)
    MAX_TIME_MS: 1000, // Hard cap to maintain server responsiveness
    TARGET_P95_MS: 1000, // Target latency for production AI moves
    BUDGET_MS: {
      EASY: 350,
      MEDIUM: 700,
      HARD: 1000,
    },
    STOCHASTIC_SAMPLES: {
      EASY: 1,
      MEDIUM: 2,
      HARD: 3,
    },
    // When at most this many placeable tiles remain, the search switches to an
    // exact deterministic minimax to the end of the game (no heuristic leaf, no
    // stochastic sampling). The remaining game tree is tiny here, so the AI
    // plays the endgame perfectly — the phase where players most often exploit
    // heuristic mistakes. Kept conservative to bound worst-case branching;
    // raise only if profiling shows headroom.
    EXACT_ENDGAME_MAX_EMPTY: 6,
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
      RANDOMNESS: 0, // Hard mode is fully deterministic
    },
  },
} as const;

// Starter Pack Configuration
export const STARTER_CONFIG = {
  DECK_NAME: "Starter Deck",
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
    MAX_REQUESTS: 75,
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
  SOCKET_JOIN_GAME: {
    WINDOW_MS: 10 * 1000, // 10 seconds
    MAX_REQUESTS: 10,
  },
  AI_ACTION: {
    WINDOW_MS: 1 * 1000, // 1 second
    MAX_REQUESTS: 40,
  },
  // Account creation, keyed on the real client IP (see utils/clientIp.ts).
  // Sized against an observed abuse batch that registered ~20 accounts at
  // 2-4 minute intervals: 3/hour stops that while leaving room for shared
  // networks (households, schools, cafes) where several people may sign up.
  // Env-overridable so the threshold can be loosened without a redeploy if
  // it proves too tight for legitimate players.
  REGISTRATION: {
    WINDOW_MS: Number(process.env.REGISTRATION_RATE_LIMIT_WINDOW_MS) || 60 * 60 * 1000,
    MAX_REQUESTS: Number(process.env.REGISTRATION_RATE_LIMIT_MAX) || 3,
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

/**
 * Embers — the entry currency for solo and Ascendant's Spire games.
 *
 * Starting a solo or tower game spends one. A game that spent one awards card
 * XP and contributes its souls to the season total; a game started on an empty
 * balance plays normally but does neither. Embers are not spent by PvP, ranked
 * draft, or Sagas.
 *
 * REGEN_CAP is a ceiling on *regeneration*, not on the balance. Purchases and
 * rewards can push a player above it, and regeneration simply contributes
 * nothing until they spend back down under it — it must never claw a balance
 * back down to the cap.
 *
 * The economy is gated by the `embers-economy` feature flag (EMBERS_FLAG). With
 * it off nothing is spent and every game is treated as funded, which is exactly
 * the behaviour that predates embers.
 */
export const EMBER_CONFIG = {
  /** Regeneration ceiling. Balances above this are left alone. */
  REGEN_CAP: 60,
  /** One ember per this many milliseconds. */
  REGEN_INTERVAL_MS: 30 * 60 * 1000,
  /** Spent to start an ember-funded solo or tower game. */
  GAME_COST: 1,
  /** Embers granted by one daily shop bundle purchase. */
  SHOP_BUNDLE_AMOUNT: 60,
} as const;

/** Feature flag gating ember spending and the XP/souls withholding. */
export const EMBERS_FLAG = "embers-economy";

/**
 * Shop overhaul configuration.
 *
 * Flag-off (`SHOP_CONFIG.FLAG` disabled) is byte-identical to the pre-overhaul
 * behaviour: the old index-based rotation, no Soul Shop, no tab resets, and no
 * guaranteed art variant in a 10-pack. That is what makes this revertible
 * without a redeploy.
 */
export const SHOP_CONFIG = {
  /** Gates the rotation change, the Soul Shop, tab resets, and the 10-pack pity. */
  FLAG: "shop-overhaul",
  /** Gates the paid ("Vault") tab. Mock listings until real IAP ships. */
  IAP_FLAG: "iap-store",

  /** Card fragments granted by one fragment_bundle purchase. */
  FRAGMENT_BUNDLE_AMOUNT: 150,
  /** Fate coins granted by one fate_coin_bundle purchase. */
  FATE_COIN_BUNDLE_AMOUNT: 2,

  /**
   * Soul Shop prices, in card fragments.
   *
   * Commons only. Rares moved to the daily tab's rotation (`rare_card`), so
   * listing them here as well would undercut it — the Forge is exhaustive, and
   * a card available every day is never worth waiting a rotation for.
   */
  SOUL_SHOP_PRICES: {
    common: 10,
  } as Record<string, number>,

  /**
   * Paid tab reset pricing: 50, 100, 200, 400 … doubling with each reset within
   * the same period. Deliberately unbounded — the doubling makes it
   * self-limiting long before any cap would bite.
   */
  RESET_BASE_GEMS: 50,

  /**
   * Minimum packs in one open for the guaranteed art variant.
   *
   * The point of the guarantee is to give the 10-pack button a reason to exist
   * over ten single opens, so it is deliberately not prorated to smaller opens.
   */
  VARIANT_PITY_MIN_PACKS: 10,

  /**
   * Base-rarity weights used when the pity pass has to mint a variant. Mirrors
   * `getPackRateConfiguration().variant_base_tier_chances`, so a pity variant
   * is distributed like a naturally rolled one.
   */
  VARIANT_PITY_BASE_WEIGHTS: {
    common: 35,
    rare: 30,
    epic: 20,
    legendary: 15,
  } as Record<string, number>,
} as const;

/**
 * The Forge: craft any card by paying card fragments for how *specific* the
 * result is.
 *
 * The price is a product of two independent choices, which is what makes the
 * economy legible to a player mid-save-up:
 *
 *   price = TIER_COST[tier] × (character chosen ? CHARACTER_MULT : 1) × VARIANT_MULT[upgrade]
 *
 * Rather than store that product, the two axes are stored separately so the
 * cost summary can show its own arithmetic ("Legendary 80 × specific 2.5 ×
 * ++ 2.0"). CHARACTER_COST is expressed as an absolute price per tier rather
 * than a multiplier because the design brief fixes both numbers independently
 * (common: 10 random / 30 specific — a 3× ratio; legendary: 80 / 200 — 2.5×).
 *
 * Worked example from the brief: a specific legendary character with `++`
 * artwork costs 200 × 2 = 400; a random legendary `++` costs 80 × 2 = 160.
 *
 * The Forge tab itself is already gated by SHOP_CONFIG.FLAG (the shop
 * overhaul), which is what makes this revertible: with that flag off the tab
 * is not rendered and none of these numbers are read. A second flag of its own
 * would gate an already-gated surface.
 */
export const FORGE_CONFIG = {
  /** Tiers the Forge can craft, in display order. */
  TIERS: ["common", "rare", "epic", "legendary"] as const,

  /** Cosmetic upgrade suffixes, in display order. "" is the base artwork. */
  UPGRADES: ["", "+", "++", "+++"] as const,

  /** Fragment cost of a RANDOM card of the given base tier, base artwork. */
  TIER_COST: {
    common: 10,
    rare: 20,
    epic: 40,
    legendary: 80,
  } as Record<string, number>,

  /** Fragment cost when the player names the exact character in that tier. */
  CHARACTER_COST: {
    common: 30,
    rare: 50,
    epic: 100,
    legendary: 200,
  } as Record<string, number>,

  /**
   * Multiplier applied for the chosen artwork upgrade. Base art is free; the
   * `+` tiers cost 2× / 3× / 4×.
   *
   * Deliberately identical to UPGRADE_SHARD_MULTIPLIER: a cosmetic upgrade is
   * worth the same moving into the Forge (sacrifice) as out of it (craft). An
   * earlier draft charged 1.5×/2×/3× here while sacrifice paid 2×/3×/4×, which
   * made base-art duplicates the cheapest fuel and upgraded cards the cheapest
   * product — backwards from the intent that good art is the reward. Keep
   * these two tables in step if either moves.
   */
  VARIANT_MULTIPLIER: {
    "": 1,
    "+": 2,
    "++": 3,
    "+++": 4,
  } as Record<string, number>,

  /**
   * Fragments granted for sacrificing one card, by base rarity, multiplied by
   * UPGRADE_SHARD_MULTIPLIER for `+` cards.
   *
   * Replaces the flat 1-fragment-per-card rule, which priced a sacrificed
   * legendary the same as a duplicate common and made the Forge's larger
   * numbers unreachable. Uncommon is absent from the brief's table and sits
   * between common and rare.
   */
  SACRIFICE_SHARDS: {
    common: 1,
    uncommon: 3,
    rare: 5,
    epic: 12,
    legendary: 25,
  } as Record<string, number>,

  /** Sacrifice payout multiplier for `+` / `++` / `+++` cards. */
  UPGRADE_SHARD_MULTIPLIER: {
    "": 1,
    "+": 2,
    "++": 3,
    "+++": 4,
  } as Record<string, number>,
} as const;

/** Mythology sets the daily rotation cycles through. */
export const SHOP_MYTHOLOGIES = ["norse", "japanese", "polynesian"] as const;

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

// Chat Configuration
export const CHAT_CONFIG = {
  /** Hard cap on a single text message, enforced server-side. */
  MAX_MESSAGE_LENGTH: 300,
  /** Newest-N kept in memory per channel by the client ring buffer. */
  CLIENT_BUFFER_SIZE: 200,

  // Rate limiting (in-memory token bucket, per user).
  // Degrades safely: a restart grants everyone a fresh bucket.
  RATE_LIMIT: {
    /** Bucket capacity — the allowed burst. */
    BURST: 5,
    /** Window over which the burst refills, in ms. */
    REFILL_WINDOW_MS: 10_000,
    /** Hard floor between any two messages, in ms. */
    MIN_INTERVAL_MS: 1_000,
    /** Card shares are rate limited more tightly than text, in ms. */
    SHARE_INTERVAL_MS: 30_000,
  },

  /**
   * Full-history retention. Moderator-deleted rows are kept beyond this as
   * an audit trail. Raise without a code change if moderation load justifies.
   */
  RETENTION_DAYS: 7,
  /** Batch size for the retention sweeper, to avoid a long lock. */
  RETENTION_SWEEP_BATCH: 5_000,
  /** How often the retention sweeper runs, in ms. */
  RETENTION_SWEEP_INTERVAL_MS: 24 * 60 * 60 * 1000,

  /** Cards returned by the public showcase endpoint. */
  SHOWCASE_CARD_COUNT: 3,
  /** Showcase cache TTL, in seconds. */
  SHOWCASE_CACHE_TTL_SECONDS: 60,

  /** Tower floors that trigger a global announcement (every Nth floor). */
  TOWER_ANNOUNCE_INTERVAL: 100,
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
