import { BattleMechanicConfig } from "../types/battleMechanic.types";
import { validateBattleMechanics } from "./battleMechanics";

/** Legacy Ragnarok configuration keeps its defaults; new seasons opt into explicit mechanics. */
export function resolveSagaMechanics(
  seasonal: Record<string, unknown>,
  legacy: { defeats_per_destroy: number; pre_destroyed_tiles: number }
): BattleMechanicConfig[] {
  let configs: BattleMechanicConfig[];
  if (Object.prototype.hasOwnProperty.call(seasonal, "mechanics")) {
    if (!Array.isArray(seasonal.mechanics)) throw new Error("seasonal mechanics must be an array");
    configs = seasonal.mechanics as BattleMechanicConfig[];
  } else if (seasonal.id === "haunted" || seasonal.type === "haunted") {
    configs = [{ id: "haunted", tile_count: seasonal.tile_count as number }];
  } else if ((!seasonal.id && !seasonal.type) || (seasonal.id ?? seasonal.type) === "worlds_end") {
    configs = [{ id: "worlds_end", ...legacy }];
  } else {
    throw new Error(`Unknown seasonal mechanic: ${seasonal.id ?? seasonal.type}`);
  }
  validateBattleMechanics(configs);
  return configs;
}
