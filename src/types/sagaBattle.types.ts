import type { SagaBattleDifficulty, SagaFloorDifficulty } from "./sagaMap.types";

export interface SagaWorldsEndState {
  defeats_per_destroy: number;
  defeats_since_destroy: number;
}

export interface SagaBattleContext {
  run_id: string;
  node_id: string;
  season_id: string;
  floor: number;
  floor_difficulty: SagaFloorDifficulty;
  battle_difficulty: SagaBattleDifficulty;
  enemy_stat_bonus: number;
  ai_profile: "basic" | "intermediate" | "advanced";
  worlds_end: SagaWorldsEndState;
  /** saga_card_id -> true if slayer buff already applied this battle */
  slayer_applied?: Record<string, boolean>;
  /** user_id -> number of cards placed this battle */
  player_cards_played?: Record<string, number>;
  /**
   * user_id -> list of placed card instance IDs for this battle.
   * Used by Fury Blessing progression so only actually played cards gain stacks.
   */
  player_card_instance_ids_played?: Record<string, string[]>;
  /**
   * Optional one-time opening constraint for saga bosses.
   * When present and pending, the AI should attempt to play this card on its first action.
   */
  forced_ai_opening_card_instance_id?: string;
  ai_opening_play_pending?: boolean;
  /**
   * saga_card_id -> count of pending +1 steals earned by Slayer Blessing
   * cards this battle. Applied to the card's currently-lowest power side
   * (one at a time) at battle end, similar to Fury rune stack progression.
   */
  slayer_pending_steals?: Record<string, number>;
  /** saga_card_id -> true if Thorns Blessing has already destroyed an attacker this battle */
  thorns_used?: Record<string, boolean>;
}

export interface SagaBattleStartResponse {
  game_id: string;
  run_id: string;
  node_id: string;
  floor: number;
  node_type: string;
  battle_difficulty?: SagaBattleDifficulty;
  opponent_deck_name?: string;
}

export interface SagaBattleCompletionResult {
  won: boolean;
  run_id: string;
  node_id: string;
  currency_earned: number;
  run_currency_delta: number;
  map_view?: unknown;
  /** Present on victory — claim via POST /rewards/battle before map advances */
  pending_reward?: import("./sagaReward.types").SagaPendingNodeReward;
  defeat_result?: import("./sagaLifecycle.types").SagaDefeatResult;
}

export interface SagaFloorBattleConfig {
  enemy_stat_bonus: number;
  pre_destroyed_tiles: number;
  ai_profile: "basic" | "intermediate" | "advanced";
}

export const SAGA_FLOOR_BATTLE_CONFIG: Record<number, SagaFloorBattleConfig> = {
  1: { enemy_stat_bonus: 1, pre_destroyed_tiles: 0, ai_profile: "advanced" },
  2: { enemy_stat_bonus: 3, pre_destroyed_tiles: 1, ai_profile: "advanced" },
  3: { enemy_stat_bonus: 5, pre_destroyed_tiles: 2, ai_profile: "advanced" },
};
