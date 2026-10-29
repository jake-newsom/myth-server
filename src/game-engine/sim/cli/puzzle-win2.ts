/**
 * Harvests Weekly Riddle candidates ("win in 2") from random self-play.
 *
 *   npx ts-node --transpile-only src/game-engine/sim/cli/puzzle-win2.ts \
 *     --minutes 30 [--seed 1] [--pool .ai-sim/deck-pool.json] [--out .ai-sim/puzzles-win2.json]
 *
 * A position qualifies when it's the mover's turn with exactly 3 placements
 * left, decks are emptied (riddles never draw), and exactly one first move wins
 * against every reply — under two different RNG seeds. Import the output with
 * src/scripts/import-riddle-candidates.ts.
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
import { GameStatus } from "../../game.logic";
import * as validators from "../../game.validators";
import { simulationContext } from "../../simulation.context";
import { DeckPool } from "../sim.types";
import { createAgent } from "../sim.agents";
import { createDeckPicker, playSimGame } from "../sim.game";
import {
  RIDDLE_PLIES,
  distinctMoves,
  emptyTiles,
  moveKey,
  playMove,
  scoreDiff,
  winningFirstMoves,
  withEmptyDecks,
} from "../../riddle.solver";

// Hand-choice abilities aren't branched by the solver (it takes the strongest pick).
const EXCLUDED_ABILITY_CARDS = new Set(["Frigg"]);

const card = (s: GameState, id: string) => s.hydrated_card_data_cache![id] as InGameCard;

async function main() {
  const minutes = parseFloat(opt("minutes", "30"));
  const baseSeed = parseInt(opt("seed", "1"), 10);
  const pool: DeckPool = JSON.parse(fs.readFileSync(path.resolve(opt("pool", ".ai-sim/deck-pool.json")), "utf8"));
  const agent = createAgent(opt("agent", "random"));
  const pickDeck = createDeckPicker(pool.decks, baseSeed);
  const outPath = opt("out", ".ai-sim/puzzles-win2.json");
  const deadline = Date.now() + minutes * 60_000;

  const funnel = { games: 0, threeLeft: 0, noExcluded: 0, solvable: 0, unique: 0, deterministic: 0, greedyFails: 0, errors: 0 };
  const seen = new Set<string>();
  const puzzles: any[] = [];
  const started = Date.now();

  while (Date.now() < deadline) {
    const seed = baseSeed * 100_003 + funnel.games++;
    let position: GameState | null = null;
    await playSimGame({
      p1: agent, p2: agent, p1Deck: pickDeck(), p2Deck: pickDeck(), seed,
      onState: (s) => {
        if (!position && s.status === GameStatus.ACTIVE && !s.pending_choice
          && validators.canPlayerPlay(validators.getPlayer(s, s.current_player_id))
          && emptyTiles(s) === RIDDLE_PLIES) position = withEmptyDecks(s);
      },
    });
    if (!position) continue;
    const state: GameState = position;
    funnel.threeLeft++;

    const inPlay = [...state.player1.hand, ...state.player2.hand]
      .concat(state.board.flat().map((c) => c?.card?.user_card_instance_id).filter(Boolean) as string[])
      .map((id) => card(state, id).base_card_data?.name);
    if (inPlay.some((n) => EXCLUDED_ABILITY_CARDS.has(n))) continue;
    funnel.noExcluded++;

    const me = state.current_player_id;
    try {
      const winsA = await winningFirstMoves(state, seed + 1);
      if (!winsA.length) continue;
      funnel.solvable++;
      if (winsA.length !== 1) continue;
      funnel.unique++;
      const winsB = await winningFirstMoves(state, seed + 7919);
      if (winsB.length !== 1 || moveKey(state, winsB[0]) !== moveKey(state, winsA[0])) continue;
      funnel.deterministic++;

      const solution = winsA[0];
      const before = scoreDiff(state, me);
      const gains = await simulationContext.withSimulation(async () => {
        const out: { key: string; m: typeof solution; gain: number }[] = [];
        for (const m of distinctMoves(state, me)) out.push({ key: moveKey(state, m), m, gain: scoreDiff(await playMove(state, m), me) - before });
        return out;
      }, seed + 1);
      const solKey = moveKey(state, solution);
      const solGain = gains.find((g) => g.key === solKey)!.gain;
      const greedy = _.maxBy(gains, (g) => g.gain)!;
      const greedyFails = greedy.gain > solGain;
      if (greedyFails) funnel.greedyFails++;

      const boardKey = JSON.stringify(state.board.map((r) => r.map((c) => c?.card ? `${c.card.base_card_id}:${c.card.owner === me ? 1 : 0}` : c?.tile_enabled === false ? "x" : "")));
      const handKey = [state.player1.hand, state.player2.hand].map((h) => h.map((id) => card(state, id).base_card_id).sort().join(",")).join("|");
      if (seen.has(boardKey + handKey)) continue;
      seen.add(boardKey + handKey);

      puzzles.push({
        seed,
        scoreBefore: before,
        firstMoves: gains.length,
        solution: { card: card(state, solution.cardId).base_card_data?.name, pos: solution.position, immediateGain: solGain },
        greedy: { card: card(state, greedy.m.cardId).base_card_data?.name, pos: greedy.m.position, immediateGain: greedy.gain },
        greedyFails,
        state,
      });
    } catch {
      funnel.errors++;
    }

    const secs = (Date.now() - started) / 1000;
    process.stdout.write(`\r${secs.toFixed(0)}s  games ${funnel.games}  checked ${funnel.threeLeft}  puzzles ${puzzles.length} (${funnel.greedyFails} trap)   `);
  }

  const secs = (Date.now() - started) / 1000;
  console.log(`\n\n=== win-in-2 harvest (no draws): ${funnel.games} games in ${(secs / 60).toFixed(1)} min ===`);
  for (const [k, v] of Object.entries(funnel)) {
    console.log(`${k.padEnd(14)} ${String(v).padStart(7)}  ${funnel.threeLeft ? ((v / funnel.threeLeft) * 100).toFixed(2) + "%" : ""}`);
  }
  console.log(`saved: ${puzzles.length}  (~${((puzzles.length / secs) * 3600).toFixed(0)}/hour)`);

  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(puzzles, (k, v) => (k === "sourceCard" ? undefined : v), 1));
  console.log(`puzzles → ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
