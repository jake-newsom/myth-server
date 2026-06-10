/** Node map types — GDD Sections 3 & 12 */

export type SagaNodeType = "battle" | "card_reward" | "boss";
export type SagaBattleDifficulty = "easy" | "hard";
export type SagaFloorDifficulty = "normal" | "hard" | "hell";
export type SagaNodeStatus =
  | "locked"
  | "available"
  | "current"
  | "completed";

export interface SagaEnemyNodePreview {
  deck_name: string;
  preview_base_card_id: string;
  preview_name: string;
  preview_image_url: string;
  preview_rarity: string;
}

export interface SagaMapNode {
  id: string;
  row: number;
  col: number;
  type: SagaNodeType;
  battle_difficulty?: SagaBattleDifficulty;
  enemy_deck_id?: string | null;
  boss_name?: string | null;
  /** Populated in map views — signature card from the enemy deck */
  enemy_preview?: SagaEnemyNodePreview | null;
  /** Node IDs in the next row this node connects to */
  next_node_ids: string[];
  /** Populated by API from run progress */
  status: SagaNodeStatus;
}

export interface SagaMapRow {
  row: number;
  nodes: SagaMapNode[];
}

export interface SagaFloorMap {
  floor: number;
  theme: string;
  difficulty: SagaFloorDifficulty;
  boss_name: string;
  rows: SagaMapRow[];
}

export interface SagaMapProgress {
  completed_node_ids: string[];
  /** Floors whose boss has been defeated (checkpoint) */
  cleared_checkpoint_floors: number[];
}

export interface SagaNodeMapData {
  version: 1;
  floors: SagaFloorMap[];
  progress: SagaMapProgress;
}

export interface SagaMapView {
  run_id: string;
  current_floor: number;
  current_node: string | null;
  map: SagaNodeMapData;
  /** Node IDs the player may enter next */
  available_node_ids: string[];
}

export const SAGA_ROW_LAYOUT = [2, 3, 3, 3, 2, 2, 1] as const;

export const SAGA_FLOOR_DEFINITIONS = [
  {
    floor: 1,
    theme: "Midgard Falls",
    difficulty: "normal" as SagaFloorDifficulty,
    boss_name: "Fenrir Unchained",
    easy_battle_ratio: 0.8,
  },
  {
    floor: 2,
    theme: "Jötunheim Falls",
    difficulty: "hard" as SagaFloorDifficulty,
    boss_name: "Jormungandr Rises",
    easy_battle_ratio: 0.5,
  },
  {
    floor: 3,
    theme: "Asgard Burns",
    difficulty: "hell" as SagaFloorDifficulty,
    boss_name: "Ragnarök",
    easy_battle_ratio: 0.2,
  },
] as const;
