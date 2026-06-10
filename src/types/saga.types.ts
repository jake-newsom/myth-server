export type SagaRunStatus = "active" | "completed" | "abandoned";
export type SagaRuneType =
  | "fury"
  | "slayer"
  | "iron"
  | "sight"
  | "thorns"
  | "first"
  | "bonds"
  | "underdog";
export type SagaDraftPhase = "legendary" | "picking" | "review" | "complete";

export interface SagaDraftState {
  phase: SagaDraftPhase;
  /** Unique base card IDs already committed to the draft */
  picked_base_card_ids: string[];
  /** 0–9: number of core draft picks completed */
  picks_completed: number;
  legendary_base_card_id?: string;
  /** Server-generated options for the current pick (cleared after selection) */
  pending_pick_options?: string[];
}

export const SAGA_DRAFT_CONFIG = {
  DECK_SIZE: 20,
  LEGENDARY_PICKS: 1,
  CORE_PICKS: 9,
  COPIES_PER_CARD: 2,
  /** Weighted rarity roll for each core draft pick option slot. */
  PICK_RARITY_WEIGHTS: {
    legendary: 0.08,
    epic: 0.39,
  },
} as const;

export interface SagaSeason {
  season_id: string;
  season_name: string;
  start_date: Date;
  end_date: Date;
  seasonal_mechanic: Record<string, unknown>;
  legendary_anchors: unknown[];
  enemy_decks: Record<string, unknown>;
  boss_configs: Record<string, unknown>;
  shop_items: unknown[];
  created_at: Date;
  updated_at: Date;
}

export interface SagaRun {
  run_id: string;
  player_id: string;
  season_id: string;
  status: SagaRunStatus;
  current_floor: number;
  current_node: string | null;
  node_map: Record<string, unknown>;
  currency_earned: number;
  run_currency: number;
  attempt_count: number;
  completed_at: Date | null;
  draft_state: SagaDraftState | null;
  pending_node_reward?: import("./sagaReward.types").SagaPendingNodeReward | null;
  created_at: Date;
  updated_at: Date;
}

export interface SagaDeck {
  deck_id: string;
  run_id: string;
  created_at: Date;
  updated_at: Date;
}

export interface SagaCard {
  saga_card_id: string;
  run_id: string;
  deck_id: string | null;
  base_card_id: string;
  top_buff: number;
  left_buff: number;
  right_buff: number;
  bottom_buff: number;
  rune_type: SagaRuneType | null;
  rune_stacks: number;
  is_active: boolean;
  modifier_floor: number;
  created_at: Date;
  updated_at: Date;
}

export interface SagaCollection {
  collection_id: string;
  run_id: string;
  created_at: Date;
  updated_at: Date;
}

export interface SagaDeckWithCards extends SagaDeck {
  cards: SagaCard[];
}

export interface SagaCollectionWithCards extends SagaCollection {
  bench_cards: SagaCard[];
}

export interface SagaRunDetail extends SagaRun {
  deck: SagaDeckWithCards | null;
  collection: SagaCollectionWithCards | null;
}

export interface CreateSagaSeasonInput {
  season_id: string;
  season_name: string;
  start_date: Date;
  end_date: Date;
  seasonal_mechanic?: Record<string, unknown>;
  legendary_anchors?: unknown[];
  enemy_decks?: Record<string, unknown>;
  boss_configs?: Record<string, unknown>;
  shop_items?: unknown[];
}

export interface UpdateSagaSeasonInput {
  season_name?: string;
  start_date?: Date;
  end_date?: Date;
  seasonal_mechanic?: Record<string, unknown>;
  legendary_anchors?: unknown[];
  enemy_decks?: Record<string, unknown>;
  boss_configs?: Record<string, unknown>;
  shop_items?: unknown[];
}

export interface CreateSagaRunInput {
  season_id: string;
  node_map?: Record<string, unknown>;
}

export interface UpdateSagaRunInput {
  status?: SagaRunStatus;
  current_floor?: number;
  current_node?: string | null;
  node_map?: Record<string, unknown>;
  currency_earned?: number;
  run_currency?: number;
  attempt_count?: number;
  completed_at?: Date | null;
  draft_state?: SagaDraftState | null;
  pending_node_reward?: import("./sagaReward.types").SagaPendingNodeReward | null;
}

export interface CreateSagaCardInput {
  base_card_id: string;
  deck_id?: string | null;
  top_buff?: number;
  left_buff?: number;
  right_buff?: number;
  bottom_buff?: number;
  rune_type?: SagaRuneType | null;
  rune_stacks?: number;
  is_active?: boolean;
  modifier_floor?: number;
}

export interface UpdateSagaCardInput {
  deck_id?: string | null;
  top_buff?: number;
  left_buff?: number;
  right_buff?: number;
  bottom_buff?: number;
  rune_type?: SagaRuneType | null;
  rune_stacks?: number;
  is_active?: boolean;
  modifier_floor?: number;
}
