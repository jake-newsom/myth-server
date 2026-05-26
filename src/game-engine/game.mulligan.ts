import _ from "lodash";
import { GameState } from "../types/game.types";
import { BaseGameEvent } from "../types/game-engine.types";
import { GameStatus } from "./game.logic";

export const MAX_MULLIGAN_REPLACEMENTS = 2;
export const MULLIGAN_DURATION_SECONDS = 30;

function getPlayerKey(state: GameState, playerId: string): "player1" | "player2" {
  if (state.player1.user_id === playerId) return "player1";
  if (state.player2.user_id === playerId) return "player2";
  throw new Error(`Player ${playerId} not found in game state`);
}

export function applyPlayerMulligan(
  state: GameState,
  playerId: string,
  replacedCardInstanceIds: string[],
): { state: GameState; events: BaseGameEvent[] } {
  if (state.status !== GameStatus.MULLIGAN) {
    throw new Error("Mulligan is only valid during MULLIGAN status");
  }
  if (replacedCardInstanceIds.length > MAX_MULLIGAN_REPLACEMENTS) {
    throw new Error(`At most ${MAX_MULLIGAN_REPLACEMENTS} cards may be replaced`);
  }
  if (!state.mulligan_state) {
    throw new Error("Game state is missing mulligan_state");
  }

  const next = _.cloneDeep(state);
  const playerKey = getPlayerKey(next, playerId);
  const player = next[playerKey];
  const playerMulligan = next.mulligan_state![playerKey];

  if (playerMulligan.committed) {
    throw new Error("Player has already committed mulligan");
  }

  for (const id of replacedCardInstanceIds) {
    if (!player.hand.includes(id)) {
      throw new Error(`Card ${id} is not in player's hand`);
    }
  }

  // Discard selected cards to bottom of deck.
  for (const id of replacedCardInstanceIds) {
    player.hand = player.hand.filter((h: string) => h !== id);
    player.deck.push(id);
  }

  // Draw N replacements from top of deck.
  for (let i = 0; i < replacedCardInstanceIds.length; i++) {
    if (player.deck.length === 0) break;
    const id = player.deck.shift()!;
    player.hand.push(id);
  }

  playerMulligan.committed = true;
  playerMulligan.replaced_count = replacedCardInstanceIds.length;

  const events: BaseGameEvent[] = [
    {
      type: "mulligan_applied",
      eventId: `mulligan-${playerId}-${Date.now()}`,
      timestamp: Date.now(),
      sourcePlayerId: playerId,
      playerId,
      replaced_count: replacedCardInstanceIds.length,
    } as any,
  ];

  return { state: next, events };
}

export function chooseAIMulligan(
  state: GameState,
  aiPlayerId: string,
): string[] {
  const playerKey = getPlayerKey(state, aiPlayerId);
  const hand = state[playerKey].hand;
  const cache = state.hydrated_card_data_cache ?? {};
  if (hand.length === 0) return [];

  const sums = hand.map((id: string) => {
    const c = cache[id];
    if (!c) return { id, sum: Infinity };
    const p = c.current_power ?? { top: 0, bottom: 0, left: 0, right: 0 };
    return { id, sum: (p.top ?? 0) + (p.bottom ?? 0) + (p.left ?? 0) + (p.right ?? 0) };
  });

  const allEqual = sums.every((s: { sum: number }) => s.sum === sums[0].sum);
  if (allEqual) return [];

  const sortedSums = sums.map((s: { sum: number }) => s.sum).sort((a: number, b: number) => a - b);
  const idx = Math.floor(0.25 * sortedSums.length);
  const threshold = sortedSums[idx];

  return sums
    .filter((s: { sum: number }) => s.sum <= threshold)
    .sort((a: { sum: number }, b: { sum: number }) => a.sum - b.sum)
    .slice(0, MAX_MULLIGAN_REPLACEMENTS)
    .map((s: { id: string }) => s.id);
}

export function finalizeMulliganIfReady(
  state: GameState,
): { state: GameState; transitioned: boolean } {
  if (state.status !== GameStatus.MULLIGAN || !state.mulligan_state) {
    return { state, transitioned: false };
  }
  const { player1, player2 } = state.mulligan_state;
  if (!player1.committed || !player2.committed) {
    return { state, transitioned: false };
  }
  const next = _.cloneDeep(state);
  next.status = GameStatus.ACTIVE;
  return { state: next, transitioned: true };
}

/**
 * Auto-commit empty mulligans for any uncommitted players and transition to ACTIVE.
 * Used when one or both clients do not support the mulligan phase (legacy rollout).
 */
export function skipMulliganPhase(
  state: GameState,
  playerIds: [string, string],
): { state: GameState; events: BaseGameEvent[] } {
  if (state.status !== GameStatus.MULLIGAN || !state.mulligan_state) {
    return { state, events: [] };
  }

  let next = state;
  const events: BaseGameEvent[] = [];

  for (const playerId of playerIds) {
    const playerKey = getPlayerKey(next, playerId);
    if (!next.mulligan_state?.[playerKey].committed) {
      const result = applyPlayerMulligan(next, playerId, []);
      next = result.state;
      events.push(...result.events);
    }
  }

  next = finalizeMulliganIfReady(next).state;
  return { state: next, events };
}

/**
 * Solo/tower bootstrap: after AI mulligan, legacy human clients skip straight to ACTIVE.
 */
export function bootstrapSoloMulliganForClient(
  state: GameState,
  humanPlayerId: string,
  supportsMulliganUi: boolean,
): { state: GameState; events: BaseGameEvent[] } {
  if (supportsMulliganUi || state.status !== GameStatus.MULLIGAN) {
    return { state, events: [] };
  }

  const playerIds: [string, string] = [state.player1.user_id, state.player2.user_id];
  return skipMulliganPhase(state, playerIds);
}

/**
 * Safety net for legacy clients that attempt a normal action while still in mulligan.
 */
export function resolveLegacyMulliganBeforeAction(
  state: GameState,
  playerId: string,
  supportsMulliganUi: boolean,
): { state: GameState; events: BaseGameEvent[] } {
  if (supportsMulliganUi || state.status !== GameStatus.MULLIGAN) {
    return { state, events: [] };
  }

  let next = state;
  const events: BaseGameEvent[] = [];
  const playerKey = getPlayerKey(next, playerId);

  if (!next.mulligan_state?.[playerKey].committed) {
    const result = applyPlayerMulligan(next, playerId, []);
    next = result.state;
    events.push(...result.events);
  }

  next = finalizeMulliganIfReady(next).state;
  return { state: next, events };
}
