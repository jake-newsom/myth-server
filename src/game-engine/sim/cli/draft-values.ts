/**
 * Learns a strength value for every draftable card by playing simulated
 * draft-format games, for the practice bot's value table.
 *
 * 1. Generate (shardable — run several in parallel with different --seed):
 *
 *   TS_NODE_TRANSPILE_ONLY=true npx ts-node src/game-engine/sim/cli/draft-values.ts \
 *     --games 2000 --seed 1 --agent greedy --out .ai-sim/draft-values/s1.jsonl
 *
 *    Each game pits two random, budget-legal, disjoint 10-card decks (every
 *    card twice, like a real draft) against each other, played seat-swapped
 *    by the same agent.
 *
 * 2. Fit:
 *
 *   TS_NODE_TRANSPILE_ONLY=true npx ts-node src/game-engine/sim/cli/draft-values.ts \
 *     --fit .ai-sim/draft-values --write content/ai/draft-card-values.json
 *
 *    L2-regularised logistic regression of the game result on
 *    (card in deck A) − (card in deck B). Each coefficient is that card's
 *    marginal effect on win-logit, ability included, measured through the real
 *    engine. A linear stat model is fitted to the coefficients as the fallback
 *    for cards added later.
 */
import * as fs from "fs";
import * as path from "path";

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

// Stub the DB before anything imports the engine (see match.ts).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const db = require("../../../config/db.config").default;
db.query = async () => {
  throw new Error("DB access during headless sim");
};

import { RANKED_DRAFT_CONFIG, RARITY_POWER_COST } from "../../../config/constants";
import { InGameCard } from "../../../types/card.types";
import { createAgent } from "../sim.agents";
import { playSimGame } from "../sim.game";
import {
  DraftPoolSnapshot,
  baseRarityOf,
  draftDeckSnapshot,
  mulberry32,
} from "../sim.draft";
import { DraftValueTable, minSide, statTotal } from "../../draft/draftBot";

const DECK_CARDS =
  RANKED_DRAFT_CONFIG.PICKS - RANKED_DRAFT_CONFIG.BLOCKS_PER_PLAYER;

interface GameRow {
  /** Card names in deck A / deck B. */
  a: string[];
  b: string[];
  /** Deck A's points in this game: 1 win, 0.5 draw, 0 loss. */
  y: number;
}

function randomLegalDeck(
  cards: InGameCard[],
  exclude: Set<string>,
  rand: () => number
): InGameCard[] {
  const shuffled = cards
    .filter((c) => !exclude.has(c.base_card_id))
    .map((c) => ({ c, k: rand() }))
    .sort((x, y) => x.k - y.k)
    .map((x) => x.c);
  const deck: InGameCard[] = [];
  let budget = RANKED_DRAFT_CONFIG.POWER_BUDGET;
  for (const card of shuffled) {
    if (deck.length >= DECK_CARDS) break;
    const cost = RARITY_POWER_COST[baseRarityOf(card.base_card_data.rarity)];
    if (cost === undefined || cost > budget) continue;
    deck.push(card);
    budget -= cost;
  }
  if (deck.length < DECK_CARDS) throw new Error("pool too small for a deck");
  return deck;
}

async function generate() {
  const games = Math.max(2, parseInt(opt("games", "1000"), 10));
  const seed = parseInt(opt("seed", "1"), 10);
  const agentName = opt("agent", "greedy");
  const poolPath = path.resolve(opt("pool", ".ai-sim/draft-pool.json"));
  const outPath = path.resolve(opt("out", `.ai-sim/draft-values/s${seed}.jsonl`));

  const pool: DraftPoolSnapshot = JSON.parse(fs.readFileSync(poolPath, "utf8"));
  const byId = new Map(pool.cards.map((c) => [c.base_card_id, c]));
  const agent = createAgent(agentName);
  const rand = mulberry32(seed);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const out = fs.createWriteStream(outPath, { flags: "a" });
  const started = Date.now();
  let errors = 0;

  for (let i = 0; i < games / 2; i++) {
    const deckA = randomLegalDeck(pool.cards, new Set(), rand);
    const deckB = randomLegalDeck(
      pool.cards,
      new Set(deckA.map((c) => c.base_card_id)),
      rand
    );
    const snapA = draftDeckSnapshot("A", deckA.map((c) => c.base_card_id), byId);
    const snapB = draftDeckSnapshot("B", deckB.map((c) => c.base_card_id), byId);
    const names = (d: InGameCard[]) => d.map((c) => c.base_card_data.name);
    const gameSeed = seed * 1_000_003 + i;

    for (const aIsP1 of [true, false]) {
      const r = await playSimGame({
        p1: agent,
        p2: agent,
        p1Deck: aIsP1 ? snapA : snapB,
        p2Deck: aIsP1 ? snapB : snapA,
        seed: gameSeed,
      });
      if (r.outcome === "error") {
        errors++;
        continue;
      }
      const aSeat = aIsP1 ? "p1" : "p2";
      const y = r.outcome === "draw" ? 0.5 : r.outcome === aSeat ? 1 : 0;
      const row: GameRow = { a: names(deckA), b: names(deckB), y };
      out.write(JSON.stringify(row) + "\n");
    }

    const played = (i + 1) * 2;
    if (played % 50 === 0) {
      const secs = (Date.now() - started) / 1000;
      process.stdout.write(
        `\r${played}/${games} games  errors ${errors}  ${(played / secs).toFixed(1)} g/s   `
      );
    }
  }
  await new Promise<void>((resolve) => out.end(resolve));
  process.stdout.write(`\ndone → ${outPath} (errors ${errors})\n`);
}

function fit() {
  const dir = path.resolve(opt("fit", ".ai-sim/draft-values"));
  const writePath = opt("write", "");
  const lambda = parseFloat(opt("l2", "1"));
  const poolPath = path.resolve(opt("pool", ".ai-sim/draft-pool.json"));
  const pool: DraftPoolSnapshot = JSON.parse(fs.readFileSync(poolPath, "utf8"));

  const rows: GameRow[] = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"))) {
    for (const line of fs.readFileSync(path.join(dir, file), "utf8").split("\n")) {
      if (line.trim()) rows.push(JSON.parse(line));
    }
  }
  if (rows.length === 0) throw new Error(`no rows in ${dir}`);

  const names = [...new Set(pool.cards.map((c) => c.base_card_data.name))];
  const index = new Map(names.map((n, i) => [n.toLowerCase(), i]));
  const n = names.length;
  const X = rows.map((r) => {
    const plus = r.a.map((s) => index.get(s.toLowerCase())).filter((i) => i !== undefined) as number[];
    const minus = r.b.map((s) => index.get(s.toLowerCase())).filter((i) => i !== undefined) as number[];
    return { plus, minus, y: r.y };
  });

  // Full-batch gradient descent with Adam on mean cross-entropy + L2/N.
  const w = new Float64Array(n);
  const m = new Float64Array(n);
  const v = new Float64Array(n);
  const lr = 0.05;
  const N = X.length;
  for (let step = 1; step <= 3000; step++) {
    const g = new Float64Array(n);
    for (const x of X) {
      let z = 0;
      for (const i of x.plus) z += w[i];
      for (const i of x.minus) z -= w[i];
      const p = 1 / (1 + Math.exp(-z));
      const err = p - x.y;
      for (const i of x.plus) g[i] += err;
      for (const i of x.minus) g[i] -= err;
    }
    for (let i = 0; i < n; i++) {
      const grad = g[i] / N + (lambda * w[i]) / N;
      m[i] = 0.9 * m[i] + 0.1 * grad;
      v[i] = 0.999 * v[i] + 0.001 * grad * grad;
      const mh = m[i] / (1 - 0.9 ** step);
      const vh = v[i] / (1 - 0.999 ** step);
      w[i] -= (lr * mh) / (Math.sqrt(vh) + 1e-8);
    }
  }

  // Coefficients are only identified up to a constant (every deck has the
  // same number of cards), so centre them: a value of 0 is an average card.
  const mean = w.reduce((s, x) => s + x, 0) / n;
  const values: Record<string, number> = {};
  names.forEach((name, i) => {
    values[name.toLowerCase()] = Math.round((w[i] - mean) * 10000) / 10000;
  });

  // Fallback: least squares value ~ intercept + statTotal + minSide.
  const byName = new Map(pool.cards.map((c) => [c.base_card_data.name.toLowerCase(), c]));
  const pts = Object.entries(values).map(([name, y]) => {
    const p = byName.get(name)!.base_card_data.base_power;
    return { s: statTotal(p), mn: minSide(p), y };
  });
  const fallback = leastSquares3(pts);

  // Fit quality: accuracy of sign(z) on decisive games.
  let correct = 0;
  let decisive = 0;
  for (const x of X) {
    if (x.y === 0.5) continue;
    let z = 0;
    for (const i of x.plus) z += w[i];
    for (const i of x.minus) z -= w[i];
    decisive++;
    if ((z > 0) === (x.y === 1)) correct++;
  }

  const table: DraftValueTable = { version: 1, values, fallback };
  const ranked = Object.entries(values).sort((a, b) => b[1] - a[1]);
  console.log(`rows ${rows.length}, cards ${n}, train acc ${(100 * correct / Math.max(1, decisive)).toFixed(1)}% (decisive ${decisive})`);
  console.log("top 10:", ranked.slice(0, 10).map(([k, x]) => `${k} ${x}`).join(", "));
  console.log("bottom 5:", ranked.slice(-5).map(([k, x]) => `${k} ${x}`).join(", "));
  console.log("fallback:", fallback);

  if (writePath) {
    const meta = {
      ...table,
      fitted_at: new Date().toISOString(),
      games: rows.length,
      pool_source: pool.source_db,
    };
    fs.mkdirSync(path.dirname(path.resolve(writePath)), { recursive: true });
    fs.writeFileSync(writePath, JSON.stringify(meta, null, 1) + "\n");
    console.log(`wrote → ${writePath}`);
  }
}

/** OLS for y ~ a + b·s + c·mn via 3×3 normal equations. */
function leastSquares3(pts: { s: number; mn: number; y: number }[]) {
  const A = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const r = [0, 0, 0];
  for (const p of pts) {
    const f = [1, p.s, p.mn];
    for (let i = 0; i < 3; i++) {
      r[i] += f[i] * p.y;
      for (let j = 0; j < 3; j++) A[i][j] += f[i] * f[j];
    }
  }
  // Gaussian elimination.
  for (let i = 0; i < 3; i++) {
    let piv = i;
    for (let k = i + 1; k < 3; k++) if (Math.abs(A[k][i]) > Math.abs(A[piv][i])) piv = k;
    [A[i], A[piv]] = [A[piv], A[i]];
    [r[i], r[piv]] = [r[piv], r[i]];
    for (let k = i + 1; k < 3; k++) {
      const f = A[k][i] / A[i][i];
      for (let j = i; j < 3; j++) A[k][j] -= f * A[i][j];
      r[k] -= f * r[i];
    }
  }
  const x = [0, 0, 0];
  for (let i = 2; i >= 0; i--) {
    let s = r[i];
    for (let j = i + 1; j < 3; j++) s -= A[i][j] * x[j];
    x[i] = s / A[i][i];
  }
  const round = (z: number) => Math.round(z * 100000) / 100000;
  return { intercept: round(x[0]), perStat: round(x[1]), perMinSide: round(x[2]) };
}

(args.includes("--fit") ? Promise.resolve(fit()) : generate())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
