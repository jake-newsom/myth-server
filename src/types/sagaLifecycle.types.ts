import type { SagaMapView } from "./sagaMap.types";

export interface SagaDefeatResult {
  run_id: string;
  node_id: string;
  had_checkpoint: boolean;
  reset_floor: number;
  message: string;
  map_view: SagaMapView;
  currency_earned: number;
  run_currency_delta: number;
}

export interface SagaRosterView {
  run_id: string;
  deck: import("./saga.types").SagaDeckWithCards;
  collection: import("./saga.types").SagaCollectionWithCards;
}

export interface SagaSeasonOverview {
  season_id: string;
  season_name: string;
  currency_balance: number;
  /** ISO timestamp when the current biweekly instance period ends. */
  instance_period_ends_at: string;
  active_run: {
    run_id: string;
    current_floor: number;
    status: string;
    draft_complete: boolean;
  } | null;
  completed_run: {
    run_id: string;
    completed_at: string | null;
  } | null;
}

export interface SagaRandomBattleStartResult {
  game_id: string;
  run_id: string;
  opponent_deck_name?: string;
}
