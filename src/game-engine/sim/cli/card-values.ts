/**
 * Measures what every card — and separately its ability — is worth, in stat
 * points, by playing simulated games through the real engine. Feeds the admin
 * Card Balance panel.
 *
 * Same game format as draft-values.ts (two random, budget-legal, disjoint
 * 10-pick decks, every pick doubled), plus two randomised treatments per pick:
 *
 *   - silence (prob --p-silence): the pick's ability is removed for the game,
 *     so  ability value = card coefficient − silenced coefficient;
 *   - jitter  (prob --p-jitter):  ±1 on all four sides, which prices one stat
 *     point in win-logit and converts every other coefficient into stat points.
 *
 * 1. Generate (shardable — run several in parallel with different --seed):
 *
 *   TS_NODE_TRANSPILE_ONLY=true npx ts-node src/game-engine/sim/cli/card-values.ts \
 *     --games 4000 --seed 1 --agent value:content/ai/value-v8.json:::rule \
 *     --out .ai-sim/card-values/s1.jsonl
 *
 * 2. Fit:
 *
 *   TS_NODE_TRANSPILE_ONLY=true npx ts-node src/game-engine/sim/cli/card-values.ts \
 *     --fit .ai-sim/card-values --write .ai-sim/card-values.json
 */
import * as fs from "fs";
import * as path from "path";
import * as _ from "lodash";

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
import { DeckSnapshot } from "../sim.types";
import { DraftPoolSnapshot, baseRarityOf, mulberry32 } from "../sim.draft";

const DECK_CARDS = RANKED_DRAFT_CONFIG.PICKS - RANKED_DRAFT_CONFIG.BLOCKS_PER_PLAYER;
const SIDES = ["top", "right", "bottom", "left"] as const;

/** One pick as played: card name, ability silenced (0/1), per-side stat jitter. */
interface Pick {
  n: string;
  s: 0 | 1;
  j: -1 | 0 | 1;
}
interface GameRow {
  a: Pick[];
  b: Pick[];
  /** Deck A's points: 1 win, 0.5 draw, 0 loss. */
  y: number;
}

function randomLegalDeck(cards: InGameCard[], exclude: Set<string>, rand: () => number) {
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

function treat(cards: InGameCard[], rand: () => number, pSilence: number, pJitter: number) {
  return cards.map((card): { card: InGameCard; pick: Pick } => {
    const hasAbility = !!card.base_card_data.special_ability;
    const s: 0 | 1 = hasAbility && rand() < pSilence ? 1 : 0;
    const j: -1 | 0 | 1 = rand() < pJitter ? (rand() < 0.5 ? -1 : 1) : 0;
    if (!s && !j) return { card, pick: { n: card.base_card_data.name, s, j } };
    const c = _.cloneDeep(card);
    if (s) c.base_card_data.special_ability = null;
    if (j) {
      for (const side of SIDES) {
        c.base_card_data.base_power[side] = Math.max(0, c.base_card_data.base_power[side] + j);
        c.current_power[side] = Math.max(0, c.current_power[side] + j);
      }
    }
    return { card: c, pick: { n: card.base_card_data.name, s, j } };
  });
}

function snapshot(name: string, cards: InGameCard[]): DeckSnapshot {
  const out: InGameCard[] = [];
  for (const c of cards)
    for (let k = 0; k < RANKED_DRAFT_CONFIG.COPIES_PER_PICK; k++) out.push(c);
  return { deck_id: name, name, source: "player", deck_effect: null, cards: out };
}

async function generate() {
  const games = Math.max(2, parseInt(opt("games", "1000"), 10));
  const seed = parseInt(opt("seed", "1"), 10);
  const agentName = opt("agent", "greedy");
  const pSilence = parseFloat(opt("p-silence", "0.5"));
  const pJitter = parseFloat(opt("p-jitter", "0.3"));
  const poolPath = path.resolve(opt("pool", ".ai-sim/draft-pool.json"));
  const outPath = path.resolve(opt("out", `.ai-sim/card-values/s${seed}.jsonl`));

  const pool: DraftPoolSnapshot = JSON.parse(fs.readFileSync(poolPath, "utf8"));
  const agent = createAgent(agentName);
  const rand = mulberry32(seed);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const out = fs.createWriteStream(outPath, { flags: "a" });
  const started = Date.now();
  let errors = 0;

  for (let i = 0; i < games / 2; i++) {
    const rawA = randomLegalDeck(pool.cards, new Set(), rand);
    const rawB = randomLegalDeck(pool.cards, new Set(rawA.map((c) => c.base_card_id)), rand);
    const A = treat(rawA, rand, pSilence, pJitter);
    const B = treat(rawB, rand, pSilence, pJitter);
    const snapA = snapshot("A", A.map((x) => x.card));
    const snapB = snapshot("B", B.map((x) => x.card));
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
      const row: GameRow = { a: A.map((x) => x.pick), b: B.map((x) => x.pick), y };
      out.write(JSON.stringify(row) + "\n");
    }

    const played = (i + 1) * 2;
    if (played % 50 === 0) {
      const secs = (Date.now() - started) / 1000;
      process.stdout.write(`\r${played}/${games} games  errors ${errors}  ${(played / secs).toFixed(1)} g/s   `);
    }
  }
  await new Promise<void>((resolve) => out.end(resolve));
  process.stdout.write(`\ndone → ${outPath} (errors ${errors})\n`);
}

/**
 * L2-regularised logistic regression of the result on (deck A − deck B) for:
 * one presence feature per card, one "silenced" feature per ability card, and a
 * single stat-jitter feature (sum of per-side jitter over picks).
 */
function fit() {
  const dir = path.resolve(opt("fit", ".ai-sim/card-values"));
  const writePath = opt("write", "");
  const lambda = parseFloat(opt("l2", "1"));
  const poolPath = path.resolve(opt("pool", ".ai-sim/draft-pool.json"));
  const pool: DraftPoolSnapshot = JSON.parse(fs.readFileSync(poolPath, "utf8"));

  const rows: GameRow[] = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".jsonl"))) {
    for (const line of fs.readFileSync(path.join(dir, f), "utf8").split("\n")) {
      if (line.trim()) rows.push(JSON.parse(line));
    }
  }
  if (!rows.length) throw new Error(`no rows in ${dir}`);

  const names = pool.cards.map((c) => c.base_card_data.name);
  const idx = new Map(names.map((n, i) => [n, i]));
  const abilityCards = pool.cards.filter((c) => c.base_card_data.special_ability).map((c) => c.base_card_data.name);
  const silIdx = new Map(abilityCards.map((n, i) => [n, names.length + i]));
  const JIT = names.length + abilityCards.length;
  const n = JIT + 1;

  // Sparse rows: feature index → value.
  type X = { f: Map<number, number>; y: number };
  const X: X[] = rows.map((r) => {
    const f = new Map<number, number>();
    const add = (k: number, v: number) => f.set(k, (f.get(k) || 0) + v);
    for (const [picks, sgn] of [[r.a, 1], [r.b, -1]] as const) {
      for (const p of picks) {
        const i = idx.get(p.n);
        if (i === undefined) continue;
        add(i, sgn);
        if (p.s) add(silIdx.get(p.n)!, sgn);
        if (p.j) add(JIT, sgn * p.j * 4);
      }
    }
    return { f, y: r.y };
  });

  // Adam on the mean log-loss + L2 (the jitter coefficient is not penalised).
  const w = new Float64Array(n);
  const m = new Float64Array(n);
  const v = new Float64Array(n);
  const N = X.length;
  const lr = 0.02;
  for (let step = 1; step <= 1500; step++) {
    const g = new Float64Array(n);
    for (const x of X) {
      let z = 0;
      for (const [k, val] of x.f) z += w[k] * val;
      const err = 1 / (1 + Math.exp(-z)) - x.y;
      for (const [k, val] of x.f) g[k] += err * val;
    }
    for (let i = 0; i < n; i++) {
      const grad = g[i] / N + (i === JIT ? 0 : (lambda * w[i]) / N);
      m[i] = 0.9 * m[i] + 0.1 * grad;
      v[i] = 0.999 * v[i] + 0.001 * grad * grad;
      const mh = m[i] / (1 - 0.9 ** step);
      const vh = v[i] / (1 - 0.999 ** step);
      w[i] -= (lr * mh) / (Math.sqrt(vh) + 1e-8);
    }
  }

  // Approximate standard errors from the diagonal of the Fisher information.
  const info = new Float64Array(n).fill(lambda);
  for (const x of X) {
    let z = 0;
    for (const [k, val] of x.f) z += w[k] * val;
    const p = 1 / (1 + Math.exp(-z));
    for (const [k, val] of x.f) info[k] += p * (1 - p) * val * val;
  }
  const se = (i: number) => 1 / Math.sqrt(info[i]);

  const perStat = w[JIT];
  if (perStat <= 0) console.warn(`WARNING: stat point coefficient ${perStat} ≤ 0 — need more games`);
  const pts = (logit: number) => Math.round((logit / perStat) * 100) / 100;
  // Presence coefficients are identified only up to a constant (every deck has
  // the same number of picks), so centre them: 0 is an average card.
  const mean = names.reduce((s, _n, i) => s + w[i], 0) / names.length;

  const cards: Record<string, unknown> = {};
  for (const c of pool.cards) {
    const name = c.base_card_data.name;
    const i = idx.get(name)!;
    const si = silIdx.get(name);
    const bp = c.base_card_data.base_power;
    cards[name] = {
      rarity: baseRarityOf(c.base_card_data.rarity),
      stat_total: bp.top + bp.right + bp.bottom + bp.left,
      // Whole card vs an average card, ability included.
      card_logit: Math.round((w[i] - mean) * 10000) / 10000,
      card_pts: pts(w[i] - mean),
      card_pts_se: Math.round((se(i) / perStat) * 100) / 100,
      // What the ability adds over the same card silenced.
      ability_pts: si === undefined ? null : pts(-w[si]),
      ability_pts_se: si === undefined ? null : Math.round((se(si) / perStat) * 100) / 100,
    };
  }

  let correct = 0;
  let decisive = 0;
  for (const x of X) {
    if (x.y === 0.5) continue;
    let z = 0;
    for (const [k, val] of x.f) z += w[k] * val;
    decisive++;
    if ((z > 0) === (x.y === 1)) correct++;
  }
  console.log(`rows ${N}, train acc ${((100 * correct) / Math.max(1, decisive)).toFixed(1)}%`);
  console.log(`one stat point = ${perStat.toFixed(4)} logit (se ${se(JIT).toFixed(4)})`);
  // Cross-check from a different source: slope of vanilla cards' coefficient on
  // their stat total. Should roughly agree with the jitter estimate.
  const vanilla = pool.cards
    .filter((c) => !c.base_card_data.special_ability)
    .map((c) => {
      const bp = c.base_card_data.base_power;
      return { s: bp.top + bp.right + bp.bottom + bp.left, y: w[idx.get(c.base_card_data.name)!] };
    });
  const ms = vanilla.reduce((a, p) => a + p.s, 0) / vanilla.length;
  const my = vanilla.reduce((a, p) => a + p.y, 0) / vanilla.length;
  const vanillaSlope =
    vanilla.reduce((a, p) => a + (p.s - ms) * (p.y - my), 0) /
    Math.max(1e-9, vanilla.reduce((a, p) => a + (p.s - ms) ** 2, 0));
  console.log(`vanilla stat-total slope = ${vanillaSlope.toFixed(4)} logit/pt (n ${vanilla.length})`);
  const ab = Object.entries(cards)
    .filter(([, c]: any) => c.ability_pts !== null)
    .sort((a: any, b: any) => b[1].ability_pts - a[1].ability_pts);
  console.log("top abilities:", ab.slice(0, 8).map(([k, c]: any) => `${k} ${c.ability_pts}±${c.ability_pts_se}`).join(", "));
  console.log("bottom abilities:", ab.slice(-5).map(([k, c]: any) => `${k} ${c.ability_pts}±${c.ability_pts_se}`).join(", "));

  if (writePath) {
    const meta = {
      version: 1,
      fitted_at: new Date().toISOString(),
      games: N,
      pool_source: pool.source_db,
      agent: opt("agent-label", "") || undefined,
      stat_point_logit: Math.round(perStat * 100000) / 100000,
      stat_point_logit_se: Math.round(se(JIT) * 100000) / 100000,
      vanilla_slope_logit: Math.round(vanillaSlope * 100000) / 100000,
      cards,
    };
    fs.mkdirSync(path.dirname(path.resolve(writePath)), { recursive: true });
    // A .ts target is the admin Card Balance panel's data module
    // (myth-tools/admin/admin-characters-ui/src/lib/balanceSim.ts).
    const body = writePath.endsWith(".ts")
      ? "// Generated by myth-server src/game-engine/sim/cli/card-values.ts --fit. Do not edit.\n" +
        'import type { SimCardValues } from "./balanceMath";\n\n' +
        `export const SIM_CARD_VALUES: SimCardValues = ${JSON.stringify(meta, null, 1)};\n`
      : JSON.stringify(meta, null, 1) + "\n";
    fs.writeFileSync(writePath, body);
    console.log(`wrote → ${writePath}`);
  }
}

(args.includes("--fit") ? Promise.resolve(fit()) : generate())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
