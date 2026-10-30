import { AsyncLocalStorage } from "async_hooks";
import type { AchievementProgressEvent } from "../services/achievement.service";
import { simulationContext } from "./simulation.context";

/**
 * Achievement progress emitted by the engine. The engine never talks to the
 * achievement service: within a move's scope events wait here until
 * updateGameAfterAction has saved the state, so a move that is rejected or
 * fails to save credits nothing.
 *
 * With no open scope an event goes straight to the sink.
 */

type Sink = (event: AchievementProgressEvent) => void;

const moveScope = new AsyncLocalStorage<AchievementProgressEvent[]>();
let sink: Sink = () => {};

export function setAchievementEventSink(next: Sink): void {
  sink = next;
}

/** Opens a move's buffer for the rest of the current async chain. */
export function beginAchievementMove(): void {
  moveScope.enterWith([]);
}

export function emitAchievementEvent(event: AchievementProgressEvent): void {
  if (simulationContext.isInSimulation()) return;
  const buffer = moveScope.getStore();
  if (buffer) {
    buffer.push(event);
  } else {
    sink(event);
  }
}

/** Call once the move's state is saved. Dispatches in emit order. */
export function flushAchievementEvents(): void {
  const buffer = moveScope.getStore();
  if (!buffer) return;
  buffer.splice(0).forEach(sink);
}
