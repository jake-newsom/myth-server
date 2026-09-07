import { v4 as uuidv4 } from "uuid";
import { BaseGameEvent, EVENT_TYPES, TileEvent } from "../types/game-engine.types";
import { GameState, TileStatus } from "../types/game.types";
import { randomInt } from "./simulation.rng";

function randomEmptyTile(
  board: GameState["board"]
): { x: number; y: number } | null {
  const empty: { x: number; y: number }[] = [];
  for (let y = 0; y < board.length; y++) {
    for (let x = 0; x < board[y].length; x++) {
      const cell = board[y][x];
      if (cell.tile_enabled && !cell.card) {
        empty.push({ x, y });
      }
    }
  }
  if (empty.length === 0) return null;
  return empty[randomInt(empty.length)];
}

export function destroyRandomEmptyTile(
  state: GameState,
  animationLabel = "worlds_end"
): { state: GameState; events: BaseGameEvent[] } {
  const pos = randomEmptyTile(state.board);
  if (!pos) return { state, events: [] };

  const cell = state.board[pos.y][pos.x];
  cell.tile_enabled = false;
  cell.tile_effect = {
    status: TileStatus.Blocked,
    turns_left: 9999,
    animation_label: animationLabel,
  };
  cell.card = null;

  const event: TileEvent = {
    type: EVENT_TYPES.TILE_STATE_CHANGED,
    eventId: uuidv4(),
    timestamp: Date.now(),
    position: pos,
    tile: {
      tile_enabled: false,
      tile_effect: cell.tile_effect,
    },
    animation: animationLabel,
  };

  return { state, events: [event] };
}

export function applyPreDestroyedTiles(
  state: GameState,
  count: number
): { state: GameState; events: BaseGameEvent[] } {
  const events: BaseGameEvent[] = [];
  let current = state;
  for (let i = 0; i < count; i++) {
    // Use worlds_end so pre-blocked saga tiles render with the same
    // visual pipeline as in-battle World's End tile destruction.
    const result = destroyRandomEmptyTile(current, "worlds_end");
    current = result.state;
    events.push(...result.events);
  }
  return { state: current, events };
}

