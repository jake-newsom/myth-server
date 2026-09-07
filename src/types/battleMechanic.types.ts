/** Serializable configuration and progress, independent of game mode. */
export type BattleMechanicConfig =
  | { id: "worlds_end"; defeats_per_destroy: number; pre_destroyed_tiles?: number }
  | { id: "haunted"; tile_count: number };

export interface BattleMechanicState {
  config: BattleMechanicConfig;
  defeats_since_destroy?: number;
}

export interface MechanicTileEffect {
  id: "haunted";
  tag: string;
  matching_bonus: number;
  other_bonus: number;
}
