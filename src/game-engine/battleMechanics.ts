import { BattleMechanicConfig, BattleMechanicState } from "../types/battleMechanic.types";
import { GameState } from "../types/game.types";
import { BaseGameEvent } from "../types/game-engine.types";
import { applyPreDestroyedTiles, destroyRandomEmptyTile } from "./battleMechanic.tiles";
import { randomInt } from "./simulation.rng";

type Definition = {
  validate(config: Record<string, unknown>): void;
  onStart?(state: GameState, mechanic: BattleMechanicState): BaseGameEvent[];
  afterDefeats?(state: GameState, mechanic: BattleMechanicState, count: number): BaseGameEvent[];
};

function integer(value: unknown, name: string, min: number): void {
  if (!Number.isSafeInteger(value) || (value as number) < min) {
    throw new Error(`${name} must be an integer >= ${min}`);
  }
}

/** Add a definition here; the engine dispatches hooks without mode-specific branches. */
export const battleMechanicRegistry: Readonly<Record<BattleMechanicConfig["id"], Definition>> = {
  worlds_end: {
    validate(config) {
      integer(config.defeats_per_destroy, "defeats_per_destroy", 1);
      integer(config.pre_destroyed_tiles ?? 0, "pre_destroyed_tiles", 0);
    },
    onStart(state, mechanic) {
      if (mechanic.config.id !== "worlds_end") return [];
      return applyPreDestroyedTiles(state, Math.min(
        mechanic.config.pre_destroyed_tiles ?? 0, state.board.flat().length
      )).events;
    },
    afterDefeats(state, mechanic, count) {
      if (mechanic.config.id !== "worlds_end") return [];
      const threshold = mechanic.config.defeats_per_destroy;
      const total = (mechanic.defeats_since_destroy ?? 0) + count;
      mechanic.defeats_since_destroy = total % threshold;
      const events: BaseGameEvent[] = [];
      for (let i = 0; i < Math.min(Math.floor(total / threshold), state.board.flat().length); i++) {
        const result = destroyRandomEmptyTile(state);
        events.push(...result.events);
        if (!result.events.length) break;
      }
      return events;
    },
  },
  haunted: {
    validate(config) { integer(config.tile_count, "tile_count", 0); },
    onStart(state, mechanic) {
      if (mechanic.config.id !== "haunted") return [];
      const candidates = state.board.flat().filter(cell => cell.tile_enabled && !cell.card && !cell.mechanic_effect);
      const count = Math.min(mechanic.config.tile_count, candidates.length);
      for (let i = 0; i < count; i++) {
        const [cell] = candidates.splice(randomInt(candidates.length), 1);
        cell.mechanic_effect = { id: "haunted", tag: "underworld", matching_bonus: 4, other_bonus: -2 };
      }
      return [];
    },
  },
};

export function validateBattleMechanics(configs: BattleMechanicConfig[]): void {
  const seen = new Set<string>();
  for (const config of configs) {
    const definition = config && Object.prototype.hasOwnProperty.call(battleMechanicRegistry, config.id)
      ? battleMechanicRegistry[config.id] : undefined;
    if (!definition) throw new Error(`Unknown battle mechanic: ${config?.id}`);
    if (seen.has(config.id)) throw new Error(`Duplicate battle mechanic: ${config.id}`);
    seen.add(config.id);
    definition.validate(config);
  }
}

/** Call once at game creation, before persisting/broadcasting the initial state. */
export function initializeBattleMechanics(state: GameState, configs: BattleMechanicConfig[]): BaseGameEvent[] {
  validateBattleMechanics(configs);
  if (state.mechanics !== undefined) throw new Error("Battle mechanics already initialized");
  state.mechanics = configs.map(config => ({ config: structuredClone(config), defeats_since_destroy: 0 }));
  return state.mechanics.flatMap(mechanic => battleMechanicRegistry[mechanic.config.id].onStart?.(state, mechanic) ?? []);
}

export function applyBattleMechanicsAfterDefeats(state: GameState, count: number): { state: GameState; events: BaseGameEvent[] } {
  integer(count, "defeat count", 0);
  // Upgrade persisted battles created before the registry. An explicit [] disables mechanics.
  if (state.mechanics === undefined && state.saga_context?.worlds_end) {
    const legacy = state.saga_context.worlds_end;
    state.mechanics = [{ config: { id: "worlds_end", defeats_per_destroy: legacy.defeats_per_destroy },
      defeats_since_destroy: legacy.defeats_since_destroy }];
  }
  validateBattleMechanics((state.mechanics ?? []).map(mechanic => mechanic.config));
  const events = (state.mechanics ?? []).flatMap(mechanic =>
    battleMechanicRegistry[mechanic.config.id].afterDefeats?.(state, mechanic, count) ?? []);
  const worldsEnd = state.mechanics?.find(mechanic => mechanic.config.id === "worlds_end");
  if (worldsEnd && state.saga_context?.worlds_end) {
    state.saga_context.worlds_end.defeats_since_destroy = worldsEnd.defeats_since_destroy ?? 0;
  }
  return { state, events };
}
