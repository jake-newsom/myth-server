import type { SagaRuneType } from "./saga.types";
import type { CardResponse } from "./api.types";

export type SagaBattleRewardKind =
  | "side_plus_2"
  | "card_plus_1_all"
  | "card_plus_2_all"
  | "blessing_offer";

export interface SagaBattleRewardOption {
  id: string;
  kind: SagaBattleRewardKind;
  label: string;
  description: string;
  /** For precision: player picks card + side via follow-up */
  buff_amount?: number;
  rune_type?: SagaRuneType;
}

export interface SagaPendingNodeReward {
  node_id: string;
  type: "card_reward" | "battle_reward";
  card_options?: string[];
  battle_options?: SagaBattleRewardOption[];
}

export interface SagaCardRewardClaimInput {
  node_id: string;
  base_card_id: string;
  /** When deck is full (20), saga card to move to bench */
  swap_out_saga_card_id?: string;
  /** When deck is full, skip adding the new card */
  skip?: boolean;
}

export interface SagaBattleRewardClaimInput {
  node_id: string;
  option_id: string;
  saga_card_id?: string;
  side?: "top" | "left" | "right" | "bottom";
  rune_type?: SagaRuneType;
}

export interface SagaRewardStatusResponse {
  pending: SagaPendingNodeReward | null;
  card_options?: CardResponse[];
  deck_size: number;
  deck_at_capacity: boolean;
}

export interface SagaRewardClaimResult {
  pending: SagaPendingNodeReward | null;
  map_view?: unknown;
  currency_balance?: number;
  saga_card_id?: string;
}
