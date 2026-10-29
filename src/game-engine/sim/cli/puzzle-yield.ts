/**
 * Throwaway experiment: how many self-play positions would make a good
 * "Daily Puzzle" (one placement, one clearly best answer, not the obvious move)?
 *
 *   npx ts-node src/game-engine/sim/cli/puzzle-yield.ts \
 *     --positions 2000 [--agent random] [--seed 1] [--pool .ai-sim/deck-pool.json]
 *
 * For each harvested position every legal move is played through the real
 * engine (twice, under different RNG seeds) and the filter funnel is reported.
 */
import * as fs from "fs";
import * as path from "path";
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
import { DeckPool, SimMove } from "../sim.types";
import { createAgent } from "../sim.agents";
import { createDeckPicker, playSimGame } from "../sim.game";
import { legalMoves } from "../sim.searchAgent";

const MIN_BOARD_CARDS = 4;
const MIN_DISTINCT_MOVES = 6;
const MIN_MARGIN = 2;

type Eval = { move: SimMove; key: string; gain: number; vanilla: number };

function opponentOf(state: GameState, playerId: string) {
  return state.player1.user_id === playerId ? state.player2 : state.player1;
}

function diff(state: GameState, playerId: string): number {
  const s = validators.calculateScores(
    state.board as any,
    state.player1.user_id,
    state.player2.user_id
  );
  return state.player1.user_id === playerId
    ? s.player1Score - s.player2Score
    : s.player2Score - s.player1Score;
}

function boardCount(state: GameState): number {
  return state.board.flat().filter((c) => c?.card).length;
}

function card(state: GameState, id: string): InGameCard {
  return state.hydrated_card_data_cache![id] as InGameCard;
}

/** Flips a player would count by eye: placed side > neighbor's facing side, no abilities/terrain. */
function vanillaFlips(state: GameState, playerId: string, m: SimMove): number {
  const p = card(state, m.cardId).current_power;
  const n = state.board.length;
  const dirs: [number, number, keyof typeof p, keyof typeof p][] = [
    [0, -1, "top", "bottom"],
    [0, 1, "bottom", "top"],
    [-1, 0, "left", "right"],
    [1, 0, "right", "left"],
  ];
  let flips = 0;
  for (const [dx, dy, mine, theirs] of dirs) {
    const x = m.position.x + dx;
    const y = m.position.y + dy;
    if (x < 0 || y < 0 || x >= n || y >= n) continue;
    const other = state.board[y][x]?.card;
    if (other && other.owner !== playerId && p[mine] > other.current_power[theirs]) flips++;
  }
  return flips;
}

async function playOut(state: GameState, playerId: string, m: SimMove, seed: number) {
  return simulationContext.withSimulation(async () => {
    let s = (await GameLogic.placeCard(_.cloneDeep(state), playerId, m.cardId, m.position)).state;
    if (s.pending_choice) {
      const chosen = GameLogic.pickStrongestPendingChoiceCards(s);
      if (chosen.length) s = (await GameLogic.resolveHandChoice(s, chosen)).state;
    }
    return diff(s, playerId);
  }, seed);
}

async function main() {
  const target = parseInt(opt("positions", "1000"), 10);
  const baseSeed = parseInt(opt("seed", "1"), 10);
  const pool: DeckPool = JSON.parse(
    fs.readFileSync(path.resolve(opt("pool", ".ai-sim/deck-pool.json")), "utf8")
  );
  const agent = createAgent(opt("agent", "random"));
  const ai = createAgent("current");
  const pickDeck = createDeckPicker(pool.decks, baseSeed);
  const outPath = opt("out", ".ai-sim/puzzle-candidates.json");

  const funnel = {
    harvested: 0,
    midgame: 0,
    enoughChoice: 0,
    deterministic: 0,
    uniqueBest: 0,
    positiveBest: 0,
    vanillaWrong: 0,
    interaction: 0,
    aiWrong: 0,
  };
  const gainDist = new Map<number, number>();
  const candidates: any[] = [];
  const started = Date.now();
  let game = 0;

  while (funnel.harvested < target) {
    const states: GameState[] = [];
    const seed = baseSeed * 100_003 + game++;
    await playSimGame({
      p1: agent,
      p2: agent,
      p1Deck: pickDeck(),
      p2Deck: pickDeck(),
      seed,
      onState: (s) => {
        if (s.status === GameStatus.ACTIVE && !s.pending_choice) states.push(_.cloneDeep(s));
      },
    });

    for (const state of states) {
      if (funnel.harvested >= target) break;
      funnel.harvested++;
      const me = state.current_player_id;
      if (boardCount(state) < MIN_BOARD_CARDS) continue;
      const moves = legalMoves(state, me);
      if (!moves.length) continue;
      funnel.midgame++;

      // Same character + same stats on the same tile is the same move to a player.
      const byKey = new Map<string, SimMove>();
      for (const m of moves) {
        const c = card(state, m.cardId);
        byKey.set(`${c.base_card_id}|${JSON.stringify(c.current_power)}|${m.position.x},${m.position.y}`, m);
      }
      if (byKey.size < MIN_DISTINCT_MOVES) continue;
      funnel.enoughChoice++;

      const before = diff(state, me);
      const evals: Eval[] = [];
      let random = false;
      try {
        for (const [key, move] of byKey) {
          const a = await playOut(state, me, move, seed + 1);
          const b = await playOut(state, me, move, seed + 7919);
          if (a !== b) { random = true; break; }
          evals.push({ move, key, gain: a - before, vanilla: vanillaFlips(state, me, move) });
        }
      } catch {
        continue;
      }
      if (random) continue;
      funnel.deterministic++;

      evals.sort((x, y) => y.gain - x.gain);
      const [best, second] = evals;
      if (best.gain - second.gain < MIN_MARGIN) continue;
      funnel.uniqueBest++;
      if (best.gain <= 0) continue;
      funnel.positiveBest++;

      // "Obvious" move: most by-eye flips, tie-break on total power.
      const power = (e: Eval) => _.sum(Object.values(card(state, e.move.cardId).current_power));
      const obvious = _.maxBy(evals, (e) => e.vanilla * 1000 + power(e))!;
      if (obvious.key === best.key) continue;
      funnel.vanillaWrong++;

      // The answer must hinge on something beyond plain side comparison.
      if (best.gain === 1 + best.vanilla * 2) continue;
      funnel.interaction++;

      let aiMove: SimMove | null = null;
      try {
        aiMove = await simulationContext.withSimulation(
          () => ai.chooseMove(_.cloneDeep(state), me),
          seed + 1
        );
      } catch { /* treat as wrong */ }
      const aiEval = aiMove && evals.find((e) => e.move.cardId === aiMove!.cardId && _.isEqual(e.move.position, aiMove!.position));
      const aiCorrect = !!aiEval && aiEval.gain === best.gain;
      if (!aiCorrect) funnel.aiWrong++;

      gainDist.set(best.gain, (gainDist.get(best.gain) ?? 0) + 1);
      candidates.push({
        seed,
        boardCards: boardCount(state),
        moves: evals.length,
        best: { card: card(state, best.move.cardId).base_card_data?.name, pos: best.move.position, gain: best.gain, vanilla: best.vanilla },
        secondGain: second.gain,
        obvious: { card: card(state, obvious.move.cardId).base_card_data?.name, gain: obvious.gain },
        aiCorrect,
        state,
      });
    }

    const secs = (Date.now() - started) / 1000;
    process.stdout.write(`\r${funnel.harvested}/${target} positions  ${game} games  ${candidates.length} candidates  ${(funnel.harvested / secs).toFixed(1)} pos/s   `);
  }

  const secs = (Date.now() - started) / 1000;
  console.log(`\n\n=== puzzle yield: ${funnel.harvested} positions from ${game} games in ${secs.toFixed(0)}s ===`);
  const pct = (n: number) => ((n / funnel.harvested) * 100).toFixed(2) + "%";
  for (const [k, v] of Object.entries(funnel)) console.log(`${k.padEnd(14)} ${String(v).padStart(7)}  ${pct(v)}`);
  console.log("\nbest-move gain distribution (score swing):");
  for (const [g, n] of [...gainDist].sort((a, b) => a[0] - b[0])) console.log(`  +${g}: ${n}`);
  const perHour = (candidates.length / secs) * 3600;
  const hard = (funnel.aiWrong / secs) * 3600;
  console.log(`\nthroughput: ~${perHour.toFixed(0)} candidates/hour, ~${hard.toFixed(0)}/hour that also beat the AI`);

  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(candidates.slice(0, 200), (k, v) => (k === "sourceCard" ? undefined : v), 1));
  console.log(`candidates (first 200) → ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
