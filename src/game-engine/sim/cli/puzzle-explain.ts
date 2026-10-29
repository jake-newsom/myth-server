/**
 * Throwaway: turns selected win-in-2 puzzles into render-ready JSON with the
 * full solution line and the refutation of the greedy move.
 *
 *   npx ts-node --transpile-only src/game-engine/sim/cli/puzzle-explain.ts --count 8
 */
import * as fs from "fs";
import * as _ from "lodash";

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const db = require("../../../config/db.config").default;
db.query = async () => {
  throw new Error("DB access during headless sim");
};

import { GameState } from "../../../types/game.types";
import { InGameCard } from "../../../types/card.types";
import { GameLogic, GameStatus } from "../../game.logic";
import * as validators from "../../game.validators";
import { simulationContext } from "../../simulation.context";
import { SimMove } from "../sim.types";
import { legalMoves } from "../sim.searchAgent";

const card = (s: GameState, id: string) => s.hydrated_card_data_cache![id] as InGameCard;

function distinctMoves(state: GameState, playerId: string): SimMove[] {
  const byKey = new Map<string, SimMove>();
  for (const m of legalMoves(state, playerId)) {
    const c = card(state, m.cardId);
    byKey.set(`${c.base_card_id}|${JSON.stringify(c.current_power)}|${m.position.x},${m.position.y}`, m);
  }
  return [...byKey.values()];
}

async function play(state: GameState, m: SimMove): Promise<GameState> {
  let s = (await GameLogic.placeCard(_.cloneDeep(state), state.current_player_id, m.cardId, m.position)).state;
  if (s.pending_choice) s = (await GameLogic.resolveHandChoice(s, GameLogic.pickStrongestPendingChoiceCards(s))).state;
  for (let i = 0; i < 4 && s.status === GameStatus.ACTIVE; i++) {
    if (validators.canPlayerPlay(validators.getPlayer(s, s.current_player_id))) break;
    s = (await GameLogic.forcePass(s, s.current_player_id)).state;
  }
  return s;
}

async function forcedWin(state: GameState, me: string, plies: number): Promise<boolean> {
  if (state.status !== GameStatus.ACTIVE) return state.winner === me;
  if (plies === 0) return false;
  const moves = distinctMoves(state, state.current_player_id);
  if (state.current_player_id === me) {
    for (const m of moves) if (await forcedWin(await play(state, m), me, plies - 1)) return true;
    return false;
  }
  for (const m of moves) if (!(await forcedWin(await play(state, m), me, plies - 1))) return false;
  return true;
}

const scores = (s: GameState, me: string) => {
  const r = validators.calculateScores(s.board as any, s.player1.user_id, s.player2.user_id);
  return s.player1.user_id === me ? [r.player1Score, r.player2Score] : [r.player2Score, r.player1Score];
};

function snapshot(s: GameState, me: string) {
  return s.board.map((row) =>
    row.map((cell) => {
      const c = cell?.card;
      return {
        disabled: cell?.tile_enabled === false,
        tile: (cell as any)?.tile_effect?.type ?? (cell as any)?.tile_effect?.status ?? null,
        card: c ? { name: c.base_card_data?.name, mine: c.owner === me, power: c.current_power } : null,
      };
    })
  );
}

const describe = (s: GameState, m: SimMove) => ({ card: card(s, m.cardId).base_card_data?.name, x: m.position.x, y: m.position.y });

function handOf(s: GameState, playerId: string) {
  return validators.getPlayer(s, playerId).hand.map((id) => {
    const c = card(s, id);
    return {
      name: c.base_card_data?.name,
      power: c.current_power,
      ability: c.base_card_data?.special_ability ? `${c.base_card_data.special_ability.name}: ${c.base_card_data.special_ability.description}` : null,
    };
  });
}

async function explain(p: any) {
  const state: GameState = p.state;
  const me = state.current_player_id;
  const opp = state.player1.user_id === me ? state.player2.user_id : state.player1.user_id;
  return simulationContext.withSimulation(async () => {
    const firsts = distinctMoves(state, me);
    const win = firsts.find((m) => m.cardId && describe(state, m).card === p.solution.card && _.isEqual(m.position, p.solution.pos))!;
    const greedy = firsts.find((m) => describe(state, m).card === p.greedy.card && _.isEqual(m.position, p.greedy.pos))!;

    // Solution line: opponent's most dangerous reply and the answer that still wins.
    const afterWin = await play(state, win);
    let line: any = null;
    let worst = Infinity;
    for (const r of distinctMoves(afterWin, opp)) {
      const afterR = await play(afterWin, r);
      const [a, b] = scores(afterR, me);
      if (a - b >= worst) continue;
      for (const m2 of afterR.status === GameStatus.ACTIVE ? distinctMoves(afterR, me) : []) {
        const fin = await play(afterR, m2);
        if (fin.status !== GameStatus.ACTIVE && fin.winner === me) {
          worst = a - b;
          line = { reply: describe(afterWin, r), answer: describe(afterR, m2), final: scores(fin, me), board: snapshot(fin, me) };
          break;
        }
      }
    }

    // Greedy refutation: the reply after which nothing wins.
    const afterG = await play(state, greedy);
    let refute: any = null;
    for (const r of distinctMoves(afterG, opp)) {
      const afterR = await play(afterG, r);
      if (!(await forcedWin(afterR, me, 1))) {
        refute = { reply: describe(afterG, r), scoreAfterGreedy: scores(afterG, me) };
        break;
      }
    }

    const meP = validators.getPlayer(state, me);
    const nextDraw = meP.deck[0] ? card(state, meP.deck[0]).base_card_data?.name : null;
    return {
      seed: p.seed,
      score: scores(state, me),
      board: snapshot(state, me),
      myHand: handOf(state, me),
      oppHand: handOf(state, opp),
      nextDraw,
      solution: { ...describe(state, win), scoreAfter: scores(afterWin, me), board: snapshot(afterWin, me) },
      line,
      greedy: { ...describe(state, greedy), refute },
    };
  }, p.seed + 1);
}

async function main() {
  const all = JSON.parse(fs.readFileSync(".ai-sim/puzzles-win2-all.json", "utf8"));
  const count = parseInt(opt("count", "8"), 10);
  // Traps only, no hand-choice cards (solver doesn't branch on those), one per solution card.
  const usedCards = new Set<string>();
  const picked: any[] = [];
  for (const p of _.sortBy(all.filter((x: any) => x.greedyFails), (x: any) => x.scoreBefore)) {
    const names = [...p.myHand, ...p.oppHand, p.solution.card];
    if (names.some((n: string) => n === "Frigg")) continue;
    if (usedCards.has(p.solution.card)) continue;
    usedCards.add(p.solution.card);
    picked.push(p);
    if (picked.length >= count) break;
  }
  const out = [];
  for (const p of picked) out.push(await explain(p));
  fs.writeFileSync(opt("out", ".ai-sim/puzzles-render.json"), JSON.stringify(out, null, 1));
  console.log(`wrote ${out.length} puzzles`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
