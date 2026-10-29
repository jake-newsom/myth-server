import * as _ from "lodash";
import { BoardPosition, GameState } from "../types/game.types";
import { InGameCard } from "../types/card.types";
import { GameLogic, GameStatus } from "./game.logic";
import * as validators from "./game.validators";
import { simulationContext } from "./simulation.context";
import { legalMoves } from "./sim/sim.searchAgent";

/*
 * Win-in-2 solver for the Weekly Riddle. A riddle is the mover's turn with
 * three placements left (me → opponent → me) and decks empty, so nothing is
 * drawn and both hands are fully known. Shared by the harvester CLI and
 * RiddleService.
 */

export const RIDDLE_PLIES = 3;

export interface RiddleMove {
  cardId: string;
  position: BoardPosition;
}

export interface AnswerEntry {
  /** The first move as the player made it (any copy with this key grades the same). */
  first: RiddleMove;
  correct: boolean;
  /** Wrong first move: a reply that leaves no win. Right: the most dangerous reply. */
  reply: RiddleMove | null;
  /** Keys of final moves that win after `reply`. Empty when `correct` is false. */
  winningFinals: string[];
}

export interface RiddleSolution {
  me: string;
  /** Keyed by moveKey of the first move. */
  answers: Record<string, AnswerEntry>;
  winningFirstKeys: string[];
}

const card = (s: GameState, id: string) =>
  s.hydrated_card_data_cache![id] as InGameCard;

/**
 * Identity of a move as a player sees it: same character with the same stats
 * on the same tile is the same choice, whichever copy in hand it is.
 */
export function moveKey(state: GameState, m: RiddleMove): string {
  const c = card(state, m.cardId);
  return `${c.base_card_id}|${JSON.stringify(c.current_power)}|${m.position.x},${m.position.y}`;
}

export function distinctMoves(state: GameState, playerId: string): RiddleMove[] {
  const byKey = new Map<string, RiddleMove>();
  for (const m of legalMoves(state, playerId)) byKey.set(moveKey(state, m), m);
  return [...byKey.values()];
}

/** Playable empty tiles for the side to move. */
export function emptyTiles(state: GameState): number {
  return new Set(
    legalMoves(state, state.current_player_id).map((m) => `${m.position.x},${m.position.y}`)
  ).size;
}

export function scoreDiff(state: GameState, me: string): number {
  const s = validators.calculateScores(state.board as any, state.player1.user_id, state.player2.user_id);
  return state.player1.user_id === me ? s.player1Score - s.player2Score : s.player2Score - s.player1Score;
}

/** Plays one placement, answering any hand choice with the strongest pick, then skips empty-handed turns. */
export async function playMove(state: GameState, m: RiddleMove): Promise<GameState> {
  let s = (await GameLogic.placeCard(_.cloneDeep(state), state.current_player_id, m.cardId, m.position)).state;
  if (s.pending_choice) {
    const chosen = GameLogic.pickStrongestPendingChoiceCards(s);
    if (!chosen.length) throw new Error("empty pending choice");
    s = (await GameLogic.resolveHandChoice(s, chosen)).state;
  }
  for (let i = 0; i < 4 && s.status === GameStatus.ACTIVE; i++) {
    if (validators.canPlayerPlay(validators.getPlayer(s, s.current_player_id))) break;
    s = (await GameLogic.forcePass(s, s.current_player_id)).state;
  }
  return s;
}

/** Does `me` force a win from here within `plies` placements? */
export async function forcedWin(state: GameState, me: string, plies: number): Promise<boolean> {
  if (state.status !== GameStatus.ACTIVE) return state.winner === me;
  if (plies === 0) return false;
  const mover = state.current_player_id;
  const moves = distinctMoves(state, mover);
  if (!moves.length) return false;
  if (mover === me) {
    for (const m of moves) if (await forcedWin(await playMove(state, m), me, plies - 1)) return true;
    return false;
  }
  for (const m of moves) if (!(await forcedWin(await playMove(state, m), me, plies - 1))) return false;
  return true;
}

/** Strips draws: a riddle position never draws, so solutions can't hinge on hidden cards. */
export function withEmptyDecks(state: GameState): GameState {
  const s = _.cloneDeep(state);
  s.player1.deck = [];
  s.player2.deck = [];
  return s;
}

/** Which first moves force the win. Cheap pass used for filtering. */
export async function winningFirstMoves(state: GameState, seed: number): Promise<RiddleMove[]> {
  const me = state.current_player_id;
  return simulationContext.withSimulation(async () => {
    const wins: RiddleMove[] = [];
    for (const m of distinctMoves(state, me)) {
      if (await forcedWin(await playMove(state, m), me, RIDDLE_PLIES - 1)) wins.push(m);
    }
    return wins;
  }, seed);
}

/**
 * Full answer table: for every first move, the server's reply and the final
 * moves that win after it. Grading at play time is a lookup into this.
 */
export async function solveRiddle(state: GameState, seed: number): Promise<RiddleSolution> {
  const me = state.current_player_id;
  return simulationContext.withSimulation(async () => {
    const answers: Record<string, AnswerEntry> = {};
    const winningFirstKeys: string[] = [];

    for (const first of distinctMoves(state, me)) {
      const key = moveKey(state, first);
      const afterFirst = await playMove(state, first);
      const opp = afterFirst.current_player_id;

      let refutation: RiddleMove | null = null;
      let danger: { reply: RiddleMove; margin: number; finals: string[] } | null = null;

      for (const reply of opp === me || afterFirst.status !== GameStatus.ACTIVE ? [] : distinctMoves(afterFirst, opp)) {
        const afterReply = await playMove(afterFirst, reply);
        const finals: string[] = [];
        if (afterReply.status !== GameStatus.ACTIVE) {
          if (afterReply.winner === me) finals.push("*");
        } else {
          for (const fin of distinctMoves(afterReply, me)) {
            const end = await playMove(afterReply, fin);
            if (end.status !== GameStatus.ACTIVE && end.winner === me) finals.push(moveKey(afterReply, fin));
          }
        }
        if (!finals.length) {
          refutation = reply;
          break;
        }
        const margin = scoreDiff(afterReply, me);
        if (!danger || margin < danger.margin) danger = { reply, margin, finals };
      }

      if (!refutation && !danger) {
        // Game ended on the first move (only possible with disabled tiles).
        const won = afterFirst.status !== GameStatus.ACTIVE && afterFirst.winner === me;
        answers[key] = { first, correct: won, reply: null, winningFinals: [] };
        if (won) winningFirstKeys.push(key);
      } else if (refutation || !danger) {
        answers[key] = { first, correct: false, reply: refutation, winningFinals: [] };
      } else {
        answers[key] = { first, correct: true, reply: danger.reply, winningFinals: danger.finals };
        winningFirstKeys.push(key);
      }
    }
    return { me, answers, winningFirstKeys };
  }, seed);
}
