import { AsyncLocalStorage } from "async_hooks";
import type { AchievementProgressEvent } from "../services/achievement.service";
import { simulationContext } from "./simulation.context";

/**
 * Player progress emitted by the engine (achievements, daily tasks). The engine
 * never talks to those services: within a move's scope events wait here until
 * updateGameAfterAction has saved the state, so a move that is rejected or
 * fails to save credits nothing.
 *
 * With no open scope an event goes straight to its sink.
 */

export type DailyTaskEvent =
  | { type: "defeat"; userId: string; setId?: string | null }
  | { type: "destroy" | "curse" | "bless"; userId: string };

type Dispatch = () => void;

const moveScope = new AsyncLocalStorage<Dispatch[]>();
let achievementSink: (event: AchievementProgressEvent) => void = () => {};
let dailyTaskSink: (event: DailyTaskEvent) => void = () => {};

export function setAchievementEventSink(sink: typeof achievementSink): void {
  achievementSink = sink;
}

export function setDailyTaskEventSink(sink: typeof dailyTaskSink): void {
  dailyTaskSink = sink;
}

/** Opens a move's buffer for the rest of the current async chain. */
export function beginAchievementMove(): void {
  moveScope.enterWith([]);
}

function emit(dispatch: Dispatch): void {
  if (simulationContext.isInSimulation()) return;
  const buffer = moveScope.getStore();
  if (buffer) {
    buffer.push(dispatch);
  } else {
    dispatch();
  }
}

export function emitAchievementEvent(event: AchievementProgressEvent): void {
  emit(() => achievementSink(event));
}

export function emitDailyTaskEvent(event: DailyTaskEvent): void {
  emit(() => dailyTaskSink(event));
}

/** Call once the move's state is saved. Dispatches in emit order. */
export function flushAchievementEvents(): void {
  const buffer = moveScope.getStore();
  if (!buffer) return;
  buffer.splice(0).forEach((dispatch) => dispatch());
}
