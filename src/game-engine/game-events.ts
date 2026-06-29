import {
  EVENT_TYPES,
  GameEventType,
  BaseGameEvent,
  CardEvent,
  CardPlacedEvent,
  CardPowerChangedEvent,
  TileEvent,
  batchEvents,
} from "../types";

// Re-export all event types and functions from the consolidated types
export {
  EVENT_TYPES,
  GameEventType,
  BaseGameEvent,
  CardEvent,
  CardPlacedEvent,
  CardPowerChangedEvent,
  TileEvent,
  batchEvents,
};

/** Minimum gap between two consecutive power-change beats (ms). */
export const EFFECT_BEAT_MS = 400;

/**
 * Extra padding (ms) added to the summed event delays when deriving how long
 * the client needs to finish animating before the next turn timer starts.
 */
export const ANIMATION_DELAY_BUFFER_MS = 500;

type PowerChangeLike = BaseGameEvent & {
  type: typeof EVENT_TYPES.CARD_POWER_CHANGED;
  cardId?: string;
  powerDelta?: number;
  powerBySide?: Partial<Record<"top" | "bottom" | "left" | "right", number>>;
  effectName?: string;
};

const isPowerChange = (e: BaseGameEvent): e is PowerChangeLike =>
  e.type === EVENT_TYPES.CARD_POWER_CHANGED;

const POWER_SIDES = ["top", "bottom", "left", "right"] as const;

/**
 * Fold `b` into `a` in place: sum scalar `powerDelta` and element-wise sum
 * `powerBySide`. Used to merge repeated same-name buffs on one card.
 */
function mergePowerChangeInto(a: PowerChangeLike, b: PowerChangeLike): void {
  a.powerDelta = (a.powerDelta ?? 0) + (b.powerDelta ?? 0);

  if (a.powerBySide || b.powerBySide) {
    const merged: Partial<Record<(typeof POWER_SIDES)[number], number>> = {
      ...(a.powerBySide ?? {}),
    };
    if (b.powerBySide) {
      for (const side of POWER_SIDES) {
        const bv = b.powerBySide[side];
        if (bv !== undefined) merged[side] = (merged[side] ?? 0) + bv;
      }
    }
    a.powerBySide = merged;
  }
}

/**
 * Normalize runs of consecutive CARD_POWER_CHANGED events so their floating
 * text reads cleanly. The client paces events by each event's `delayAfterMs`;
 * without a delay, adjacent power changes apply ~16ms apart and read as one
 * indistinguishable flash.
 *
 * Two transforms, applied within each maximal run of consecutive power-change
 * events (non-power-change events break a run and are left untouched):
 *
 *  1. MERGE — multiple changes with the same `effectName` on the same `cardId`
 *     collapse into a single event (e.g. two Kanaloas' "Tide Ward" +1 / +1 on
 *     one card → one "Tide Ward" +2). `powerDelta` is summed and `powerBySide`
 *     is summed element-wise, so directions are preserved.
 *
 *  2. BEAT-SPACE — the merged run is partitioned into "beats". A beat is a
 *     maximal group of consecutive events sharing the same `effectName` but
 *     targeting different cards (e.g. one effect buffing four cards at once).
 *     Events *within* a beat get no delay (they animate simultaneously); the
 *     last event of each beat (except the run's final beat) gets
 *     `delayAfterMs >= EFFECT_BEAT_MS` so the next, differently-named effect
 *     reads as its own beat. Existing larger delays are preserved, never shrunk.
 *
 * Returns a NEW array (merging removes elements); callers must use the result.
 * Idempotent.
 */
export function pacePowerEvents(events: BaseGameEvent[]): BaseGameEvent[] {
  if (!events?.length) return events;

  const out: BaseGameEvent[] = [];
  let i = 0;

  while (i < events.length) {
    if (!isPowerChange(events[i])) {
      out.push(events[i]);
      i++;
      continue;
    }

    // Collect the maximal run of consecutive power-change events.
    const runStart = i;
    while (i < events.length && isPowerChange(events[i])) i++;
    const run = events.slice(runStart, i) as PowerChangeLike[];

    // --- Pass 1: merge same (cardId, effectName) within the run ---
    const merged: PowerChangeLike[] = [];
    const indexByKey = new Map<string, number>();
    for (const ev of run) {
      const key = `${ev.cardId ?? ""}::${ev.effectName ?? ""}`;
      const existingIdx = indexByKey.get(key);
      if (existingIdx !== undefined) {
        mergePowerChangeInto(merged[existingIdx], ev);
      } else {
        indexByKey.set(key, merged.length);
        merged.push(ev);
      }
    }

    // --- Pass 2: beat-space the merged run ---
    // Partition into beats of consecutive same-effectName events (different
    // cards apply together); each beat but the last gets a trailing delay.
    let beatStart = 0;
    while (beatStart < merged.length) {
      const beatName = merged[beatStart].effectName ?? "";
      let beatEnd = beatStart + 1;
      while (
        beatEnd < merged.length &&
        (merged[beatEnd].effectName ?? "") === beatName
      ) {
        beatEnd++;
      }

      const isLastBeat = beatEnd >= merged.length;
      for (let k = beatStart; k < beatEnd; k++) {
        const isBeatLast = k === beatEnd - 1;
        if (isBeatLast && !isLastBeat) {
          const existing = merged[k].delayAfterMs ?? 0;
          merged[k].delayAfterMs = Math.max(existing, EFFECT_BEAT_MS);
        }
        // members within a beat keep no added delay (apply simultaneously);
        // the run's final beat keeps whatever delay it already had so it
        // doesn't add a beat before the next, unrelated event.
      }

      beatStart = beatEnd;
    }

    out.push(...merged);
  }

  return out;
}

/**
 * Total time (ms) the client needs to play through `events` before the next
 * turn timer should start: the sum of all `delayAfterMs` plus a fixed buffer.
 * Used by the multiplayer TurnManager so `server:start_turn` waits for the
 * actual (now paced) animation length instead of a flat default.
 */
export function sumAnimationDelay(events: BaseGameEvent[]): number {
  let total = 0;
  for (const e of events ?? []) {
    total += e.delayAfterMs ?? 0;
  }
  return total + ANIMATION_DELAY_BUFFER_MS;
}
