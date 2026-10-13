import * as _ from "lodash";
import { GameState, Player } from "../../types/game.types";
import { InGameCard } from "../../types/card.types";
import { GAME_CONFIG } from "../../config/constants";
import { GameLogic, GameStatus } from "../game.logic";
import * as gameUtils from "../game.utils";
import * as validators from "../game.validators";
import {
  applyPlayerMulligan,
  finalizeMulliganIfReady,
} from "../game.mulligan";
import { simulationContext } from "../simulation.context";
import { DeckSnapshot, SimAgent, SimGameResult } from "./sim.types";

/** Seat ids. Deliberately not "AI_"-prefixed so no solo-game heuristics kick in. */
export const SIM_P1 = "sim-p1";
export const SIM_P2 = "sim-p2";

const INITIAL_HAND_SIZE = 5;
// A 4x4 board fills in 16 placements; anything near this is a stuck loop.
const MAX_TURNS = 200;

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let next = Math.imul(t ^ (t >>> 15), 1 | t);
    next ^= next + Math.imul(next ^ (next >>> 7), 61 | next);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(items: T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Copies a snapshot's cards onto a seat with fresh, seat-scoped instance ids,
 * so both seats can use the same deck without colliding in the shared
 * hydrated_card_data_cache.
 */
function seatDeck(
  deck: DeckSnapshot,
  seatId: string,
  cache: Record<string, InGameCard>
): string[] {
  return deck.cards.map((card, i) => {
    const id = `${seatId}:${i}`;
    cache[id] = {
      ..._.cloneDeep(card),
      user_card_instance_id: id,
      owner: seatId,
      original_owner: seatId,
    };
    return id;
  });
}

/**
 * Builds the same starting state as the solo-game path (initializeGame + deck
 * effects + mulligan phase) but from in-memory decks, with every card
 * pre-hydrated so drawCard never falls back to the database.
 */
export function createSimGame(
  p1Deck: DeckSnapshot,
  p2Deck: DeckSnapshot,
  seed: number
): GameState {
  const rand = mulberry32(seed);
  const cache: Record<string, InGameCard> = {};
  const p1Ids = seededShuffle(seatDeck(p1Deck, SIM_P1, cache), rand);
  const p2Ids = seededShuffle(seatDeck(p2Deck, SIM_P2, cache), rand);

  const board = Array.from({ length: GAME_CONFIG.BOARD_SIZE }, () =>
    Array.from(
      { length: GAME_CONFIG.BOARD_SIZE },
      () => gameUtils.createBoardCell(null, "normal").boardCell
    )
  );

  const makePlayer = (
    userId: string,
    ids: string[],
    deck: DeckSnapshot
  ): Player => ({
    user_id: userId,
    hand: ids.slice(0, INITIAL_HAND_SIZE),
    deck: ids.slice(INITIAL_HAND_SIZE),
    discard_pile: [],
    score: 0,
    equipped_card_back: null,
    ...(deck.deck_effect
      ? {
          deck_effect: deck.deck_effect,
          deck_effect_state: { last_triggered_round: 0 },
        }
      : {}),
  });

  return {
    board,
    player1: makePlayer(SIM_P1, p1Ids, p1Deck),
    player2: makePlayer(SIM_P2, p2Ids, p2Deck),
    current_player_id: rand() < 0.5 ? SIM_P1 : SIM_P2,
    turn_number: 1,
    status: GameStatus.MULLIGAN,
    max_cards_in_hand: 10,
    initial_cards_to_draw: INITIAL_HAND_SIZE,
    hydrated_card_data_cache: cache,
    winner: null,
    mulligan_state: {
      player1: { committed: false, replaced_count: 0 },
      player2: { committed: false, replaced_count: 0 },
    },
  };
}

export interface PlaySimGameOptions {
  p1: SimAgent;
  p2: SimAgent;
  p1Deck: DeckSnapshot;
  p2Deck: DeckSnapshot;
  seed: number;
  /** Called with every state the game passes through (for data export later). */
  onState?: (state: GameState) => void;
}

/**
 * Plays one full standard 1v1 game headlessly. Mirrors the live controller's
 * turn handling: no cards → forcePass, no chosen move → endTurn, and a
 * pending_choice is answered by the same seat before the turn continues.
 *
 * Runs inside a seeded simulation context, which both makes engine randomness
 * reproducible and suppresses achievement/daily-task side effects.
 */
export async function playSimGame(
  opts: PlaySimGameOptions
): Promise<SimGameResult> {
  const started = Date.now();
  const result: SimGameResult = {
    seed: opts.seed,
    outcome: "error",
    p1Agent: opts.p1.name,
    p2Agent: opts.p2.name,
    p1Deck: opts.p1Deck.name,
    p2Deck: opts.p2Deck.name,
    p1Score: 0,
    p2Score: 0,
    turns: 0,
    durationMs: 0,
    decisionMs: { p1: 0, p2: 0 },
    decisions: { p1: 0, p2: 0 },
    handChoices: 0,
  };

  const seatOf = (playerId: string) => (playerId === SIM_P1 ? "p1" : "p2");
  const agentOf = (playerId: string) =>
    playerId === SIM_P1 ? opts.p1 : opts.p2;

  const timed = async <T>(playerId: string, fn: () => Promise<T>) => {
    const t0 = Date.now();
    const value = await fn();
    const seat = seatOf(playerId);
    result.decisionMs[seat] += Date.now() - t0;
    result.decisions[seat] += 1;
    return value;
  };

  try {
    await simulationContext.withSimulation(async () => {
      let state = createSimGame(opts.p1Deck, opts.p2Deck, opts.seed);

      for (const playerId of [SIM_P1, SIM_P2]) {
        const replaced = await timed(playerId, () =>
          agentOf(playerId).chooseMulligan(_.cloneDeep(state), playerId)
        );
        state = applyPlayerMulligan(state, playerId, replaced).state;
      }
      state = finalizeMulliganIfReady(state).state;
      opts.onState?.(state);

      while (state.status === GameStatus.ACTIVE) {
        if (result.turns >= MAX_TURNS) {
          throw new Error(`exceeded ${MAX_TURNS} turns`);
        }
        result.turns++;

        const playerId = state.current_player_id;
        const player = validators.getPlayer(state, playerId);

        if (!validators.canPlayerPlay(player)) {
          state = (await GameLogic.forcePass(state, playerId)).state;
        } else {
          const move = await timed(playerId, () =>
            agentOf(playerId).chooseMove(_.cloneDeep(state), playerId)
          );
          if (!move) {
            state = (await GameLogic.endTurn(state, playerId)).state;
          } else {
            state = (
              await GameLogic.placeCard(
                state,
                playerId,
                move.cardId,
                move.position
              )
            ).state;

            if (state.pending_choice) {
              result.handChoices++;
              const chooserId = state.pending_choice.chooser_id;
              const chosen = await timed(chooserId, () =>
                agentOf(chooserId).chooseHandTargets(
                  _.cloneDeep(state),
                  chooserId
                )
              );
              if (chosen.length > 0) {
                state = (await GameLogic.resolveHandChoice(state, chosen))
                  .state;
              } else {
                // Nothing to pick: still run the deferred draw + endTurn, or
                // the game would stall on the chooser's turn.
                state = { ...state, pending_choice: undefined };
                state = (
                  await (GameLogic as any).finishPlacement(
                    state,
                    chooserId,
                    false
                  )
                ).state;
              }
            }
          }
        }
        opts.onState?.(state);
      }

      result.p1Score = state.player1.score;
      result.p2Score = state.player2.score;
      result.outcome =
        state.winner === SIM_P1 ? "p1" : state.winner === SIM_P2 ? "p2" : "draw";
    }, opts.seed);
  } catch (err) {
    result.outcome = "error";
    result.error = err instanceof Error ? err.message : String(err);
  }

  result.durationMs = Date.now() - started;
  return result;
}

/**
 * Seeded deck sampler. `playerShare` is the chance a seat gets a real player
 * deck (vs an AI deck) when the pool has both — uniform sampling would
 * under-represent player decks, which are a small slice of the pool.
 */
export function createDeckPicker(
  decks: DeckSnapshot[],
  seed: number,
  playerShare = 0.5
): () => DeckSnapshot {
  const rand = mulberry32(seed);
  const player = decks.filter((d) => d.source === "player");
  const ai = decks.filter((d) => d.source === "ai");
  const from = (list: DeckSnapshot[]) => list[Math.floor(rand() * list.length)];
  return () => {
    if (!player.length || !ai.length) return from(decks);
    return rand() < playerShare ? from(player) : from(ai);
  };
}
