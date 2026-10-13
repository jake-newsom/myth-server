/**
 * Headless AI-vs-AI matchup harness for standard 1v1.
 *
 *   npx ts-node src/game-engine/sim/cli/match.ts \
 *     --a current --b random --games 200 [--seed 1] [--pool .ai-sim/deck-pool.json]
 *
 * Games run in seat-swapped pairs: each pair shares a seed and deck pairing,
 * with A as p1 then as p2, which cancels first-move and deck-draw luck.
 *
 * The database is stubbed to throw, so any engine path that still reaches for
 * it surfaces as an error (and is counted in the DB-access audit) instead of
 * silently querying.
 */
import * as fs from "fs";
import * as path from "path";

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

// Stub the DB before anything imports the engine.
const dbHits = new Map<string, number>();
// eslint-disable-next-line @typescript-eslint/no-var-requires
const db = require("../../../config/db.config").default;
db.query = async (text: string) => {
  const key = text.replace(/\s+/g, " ").trim().slice(0, 90);
  dbHits.set(key, (dbHits.get(key) ?? 0) + 1);
  throw new Error("DB access during headless sim");
};

import { DeckPool, SimGameResult } from "../sim.types";
import { createAgent } from "../sim.agents";
import { createDeckPicker, playSimGame } from "../sim.game";


async function main() {
  const aName = opt("a", "current");
  const bName = opt("b", "random");
  const pairs = Math.max(1, Math.ceil(parseInt(opt("games", "100"), 10) / 2));
  const baseSeed = parseInt(opt("seed", "1"), 10);
  const poolPath = path.resolve(opt("pool", ".ai-sim/deck-pool.json"));
  const outPath = opt("out", "");

  const pool: DeckPool = JSON.parse(fs.readFileSync(poolPath, "utf8"));
  if (pool.decks.length === 0) throw new Error(`no decks in ${poolPath}`);

  const a = createAgent(aName);
  const b = createAgent(bName);
  const pickDeck = createDeckPicker(
    pool.decks,
    baseSeed,
    parseFloat(opt("player-share", "0.5"))
  );
  const mirror = args.includes("--mirror");
  const results: SimGameResult[] = [];
  const started = Date.now();

  let aPoints = 0;
  let wins = 0;
  let losses = 0;
  let draws = 0;
  const errors: SimGameResult[] = [];
  const aMs = { total: 0, n: 0 };
  const bMs = { total: 0, n: 0 };

  for (let i = 0; i < pairs; i++) {
    const seed = baseSeed * 100_003 + i;
    const d1 = pickDeck();
    // --mirror: both seats share a deck, so the result measures play only.
    const d2 = mirror ? d1 : pickDeck();

    for (const aIsP1 of [true, false]) {
      const r = await playSimGame({
        p1: aIsP1 ? a : b,
        p2: aIsP1 ? b : a,
        p1Deck: d1,
        p2Deck: d2,
        seed,
      });
      results.push(r);

      const aSeat = aIsP1 ? "p1" : "p2";
      const bSeat = aIsP1 ? "p2" : "p1";
      aMs.total += r.decisionMs[aSeat];
      aMs.n += r.decisions[aSeat];
      bMs.total += r.decisionMs[bSeat];
      bMs.n += r.decisions[bSeat];

      if (r.outcome === "error") errors.push(r);
      else if (r.outcome === "draw") (draws++, (aPoints += 0.5));
      else if (r.outcome === aSeat) (wins++, (aPoints += 1));
      else losses++;
    }

    const played = (i + 1) * 2;
    if (played % 20 === 0 || i === pairs - 1) {
      const secs = (Date.now() - started) / 1000;
      process.stdout.write(
        `\r${played} games  ${aName} ${wins}-${losses}-${draws}  errors ${errors.length}  ${(played / secs).toFixed(1)} g/s   `
      );
    }
  }
  process.stdout.write("\n");

  const scored = wins + losses + draws;
  const rate = scored ? aPoints / scored : 0;
  // Normal-approx 95% CI on the score rate.
  const ci = scored ? 1.96 * Math.sqrt((rate * (1 - rate)) / scored) : 0;
  const secs = (Date.now() - started) / 1000;

  console.log(`\n=== ${aName} vs ${bName} — ${results.length} games, ${pool.decks.length} decks (${pool.source_db}) ===`);
  console.log(`${aName}: ${wins}W ${losses}L ${draws}D  score ${(rate * 100).toFixed(1)}% ± ${(ci * 100).toFixed(1)}%`);
  console.log(`errors: ${errors.length}`);
  console.log(`speed: ${(results.length / secs).toFixed(2)} games/s, ${(secs / results.length * 1000).toFixed(0)} ms/game`);
  console.log(`ms/decision: ${aName} ${(aMs.total / Math.max(1, aMs.n)).toFixed(1)}, ${bName} ${(bMs.total / Math.max(1, bMs.n)).toFixed(1)}`);
  const turns = results.filter((r) => r.outcome !== "error").map((r) => r.turns);
  if (turns.length) {
    console.log(`turns/game: avg ${(turns.reduce((s, t) => s + t, 0) / turns.length).toFixed(1)}, hand choices: ${results.reduce((s, r) => s + r.handChoices, 0)}`);
  }

  if (errors.length) {
    const byMsg = new Map<string, number[]>();
    for (const e of errors) {
      const list = byMsg.get(e.error!) ?? [];
      list.push(e.seed);
      byMsg.set(e.error!, list);
    }
    console.log("\nerror breakdown (message → seeds):");
    for (const [msg, seeds] of byMsg) {
      console.log(`  ${seeds.length}× ${msg}  [${[...new Set(seeds)].slice(0, 5).join(", ")}]`);
    }
  }
  if (dbHits.size) {
    console.log("\nDB access audit (query → count):");
    for (const [q, n] of dbHits) console.log(`  ${n}× ${q}`);
  } else {
    console.log("DB access audit: clean (0 queries)");
  }

  if (outPath) {
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(results, null, 1));
    console.log(`results → ${outPath}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
