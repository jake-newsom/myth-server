/**
 * Weekly balance report. Read-only against prod; nothing here changes a card.
 *
 *   npx ts-node --transpile-only src/game-engine/sim/cli/balance-report.ts
 *     [--shards 8] [--games 4000]   self-play games per shard (default 8 × 4000)
 *     [--skip-sim]                  reuse the newest report's fit (pool diff + play stats only)
 *     [--out reports/balance]
 *
 * Steps:
 *   1. Export the live draft pool from prod (DATABASE_URL_PROD_READONLY, every
 *      session forced read-only) exactly as a drafted card is built.
 *   2. Diff it against the previous report's pool: stat lines, abilities, cards
 *      added or removed.
 *   3. Price every card and ability in stat points with card-values.ts
 *      self-play on that pool, sharded across processes.
 *   4. Flag cards against the agreed targets and against last week's values.
 *   5. Summarise last week's real play from prod.
 *
 * Writes <out>/<date>/REPORT.md plus pool.json and values.json for next week's diff.
 */
import "dotenv/config";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";
import { Client } from "pg";

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const ROOT = path.resolve(__dirname, "../../../..");
const OUT = path.resolve(ROOT, opt("out", "reports/balance"));
const DATE = new Date().toISOString().slice(0, 10);
const DIR = path.join(OUT, DATE);
const SHARDS = Math.max(1, parseInt(opt("shards", String(Math.min(8, Math.max(1, os.cpus().length - 2)))), 10));
const GAMES = Math.max(100, parseInt(opt("games", "4000"), 10));
const SKIP_SIM = args.includes("--skip-sim");
// The agent the panel's prod fit used: value net, 1-ply, rule-based fallbacks.
const AGENT = opt("agent", "value:content/ai/value-v8.json:::rule");

// Agreed targets (2026-11-01): most cards within ±4 stat points of their tier's
// median, at most 1–2 conditional "signature" cards per tier up to +8,
// nothing at ±8 or beyond, commons' stat totals 21–27.
const NEAR = 4;
const FAR = 8;
const COMMON_STATS: [number, number] = [21, 27];
const TIERS = ["common", "rare", "epic", "legendary"];

// ── Prod (read-only) ────────────────────────────────────────────────────────

/**
 * Builds the client from the URL's parts. The password may hold a raw `#`, and
 * pg's URL parse error echoes the whole URL, password included, so the URL is
 * never handed to pg and never logged.
 */
async function connectReadOnly(): Promise<Client> {
  const url = process.env.DATABASE_URL_PROD_READONLY ?? "";
  const m = /^postgres(?:ql)?:\/\/([^:]+):(.*)@([^@/:]+):(\d+)\/([^?]+)/.exec(url);
  if (!m) throw new Error("DATABASE_URL_PROD_READONLY is missing or not a postgres URL");
  const passwords = [m[2]];
  try {
    const decoded = decodeURIComponent(m[2]);
    if (decoded !== m[2]) passwords.push(decoded);
  } catch {
    /* not percent-encoded */
  }
  for (const password of passwords) {
    const client = new Client({
      user: decodeURIComponent(m[1]),
      password,
      host: m[3],
      port: Number(m[4]),
      database: m[5],
      ssl: { rejectUnauthorized: false },
      options: "-c default_transaction_read_only=on",
    });
    try {
      await client.connect();
      return client;
    } catch (e: any) {
      await client.end().catch(() => undefined);
      if (e?.code !== "28P01") throw new Error(`Couldn't connect to the prod database (${e?.code ?? "error"})`);
    }
  }
  throw new Error("The prod read-only login was rejected (wrong password)");
}

/** The draft pool, built by the same hydration code as a live draft, but every query goes through the read-only client. */
async function exportPool(client: Client) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const db = require("../../../config/db.config").default;
  db.query = (text: string, params?: unknown[]) => client.query(text, params as any[]);
  db.connect = async () => {
    throw new Error("balance-report: only read queries through the read-only client");
  };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const hydration = require("../../draftBattle.hydration");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ORIGINAL_RARITY_SQL } = require("../../../services/rankedDraft.service");
  const { rows } = await client.query(
    `SELECT cv.card_variant_id FROM card_variants cv WHERE ${ORIGINAL_RARITY_SQL} ORDER BY cv.card_variant_id`
  );
  const ids: string[] = rows.map((r: any) => r.card_variant_id);
  const catalog = await hydration.fetchDraftCatalogRows(ids);
  const cards = ids.filter((id) => catalog.has(id)).map((id) => hydration.buildDraftCard(catalog.get(id), "pool", `pool-${id}`));
  return { exported_at: new Date().toISOString(), source_db: "prod", cards };
}

async function q<T = any>(client: Client, sql: string, params: unknown[] = []): Promise<T[] | null> {
  try {
    return (await client.query(sql, params as any[])).rows as T[];
  } catch (e: any) {
    console.warn(`play stats query skipped: ${e?.message ?? e}`);
    return null;
  }
}

/** Last 7 days of real play: what modes people finish, how many people, how draft is going. */
async function playStats(client: Client) {
  const since = "NOW() - INTERVAL '7 days'";
  const byMode = await q(
    client,
    `SELECT CASE WHEN is_tutorial THEN 'tutorial' WHEN saga_run_id IS NOT NULL THEN 'saga' ELSE game_mode::text END AS mode,
            count(*)::int AS games,
            count(*) FILTER (WHERE game_status IN ('completed','rewarded'))::int AS finished
       FROM games WHERE created_at >= ${since} GROUP BY 1 ORDER BY 2 DESC`
  );
  const players = await q(
    client,
    `SELECT count(DISTINCT p)::int AS players FROM (
       SELECT player1_id AS p FROM games WHERE created_at >= ${since}
       UNION SELECT player2_id FROM games WHERE created_at >= ${since}) x
      WHERE p IS NOT NULL AND p IN (SELECT user_id FROM users WHERE COALESCE(is_ai, false) = false)`
  ).then(async (r) => r ?? (await q(client, `SELECT count(DISTINCT player1_id)::int AS players FROM games WHERE created_at >= ${since}`)));
  const drafts = await q(
    client,
    `SELECT vs_bot, count(*)::int AS sessions FROM ranked_draft_sessions WHERE created_at >= ${since} GROUP BY 1`
  );
  // Per-card results from game_card_results (TRACKING.md). Null if the table
  // doesn't exist yet on this database. Real players only, played cards only.
  const cardResults = await q(
    client,
    `SELECT COALESCE(ch.name, r.character_id) AS card,
            count(*)::int AS games,
            count(*) FILTER (WHERE r.result = 'win')::int AS wins
       FROM game_card_results r
       LEFT JOIN characters ch ON ch.character_id::text = r.character_id
      WHERE r.created_at >= NOW() - INTERVAL '30 days'
        AND r.was_played
        AND r.user_id IN (SELECT user_id FROM users WHERE COALESCE(is_ai, false) = false)
      GROUP BY 1
     HAVING count(*) >= 10
      ORDER BY (count(*) FILTER (WHERE r.result = 'win'))::float / count(*) DESC`
  );
  return { byMode, players: players?.[0]?.players ?? null, drafts, cardResults };
}

// ── Sim ─────────────────────────────────────────────────────────────────────

function run(argv: string[], label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("npx", ["ts-node", ...argv], {
      cwd: ROOT,
      env: { ...process.env, TS_NODE_TRANSPILE_ONLY: "true" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let tail = "";
    const keep = (d: Buffer) => (tail = (tail + d.toString()).slice(-4000));
    p.stdout.on("data", keep);
    p.stderr.on("data", keep);
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${label} failed (${code}):\n${tail}`))));
  });
}

async function simulate(poolFile: string, valuesFile: string) {
  const shardDir = path.join(ROOT, ".ai-sim/balance-shards", DATE);
  fs.rmSync(shardDir, { recursive: true, force: true });
  fs.mkdirSync(shardDir, { recursive: true });
  const cli = "src/game-engine/sim/cli/card-values.ts";
  const started = Date.now();
  console.log(`self-play: ${SHARDS} shards × ${GAMES} games (${AGENT})`);
  const base = Date.now() % 100000;
  await Promise.all(
    Array.from({ length: SHARDS }, (_, i) =>
      run(
        [cli, "--games", String(GAMES), "--seed", String(base + i), "--agent", AGENT, "--pool", poolFile, "--out", path.join(shardDir, `s${i}.jsonl`)],
        `shard ${i}`
      )
    )
  );
  console.log(`self-play done in ${Math.round((Date.now() - started) / 60000)} min; fitting`);
  await run([cli, "--fit", shardDir, "--pool", poolFile, "--write", valuesFile, "--agent-label", AGENT], "fit");
}

// ── Report ──────────────────────────────────────────────────────────────────

const SIDES = ["top", "right", "bottom", "left"] as const;
const line = (bp: any) => SIDES.map((s) => bp?.[s] ?? "?").join("/");
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};
const sign = (n: number) => (n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1));
const baseRarity = (r: string) => String(r).replace(/\+/g, "");

function previousReport(): string | null {
  if (!fs.existsSync(OUT)) return null;
  const dirs = fs
    .readdirSync(OUT)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d < DATE && fs.existsSync(path.join(OUT, d, "pool.json")))
    .sort();
  return dirs.length ? path.join(OUT, dirs[dirs.length - 1]) : null;
}

function poolDiff(prev: any | null, cur: any): string[] {
  if (!prev) return ["First report: nothing to compare against yet."];
  const byName = (p: any) => new Map<string, any>(p.cards.map((c: any) => [c.base_card_data.name, c.base_card_data]));
  const a = byName(prev);
  const b = byName(cur);
  const out: string[] = [];
  for (const [n, c] of b) {
    const o = a.get(n);
    if (!o) {
      out.push(`**${n}** added (${baseRarity(c.rarity)}, ${line(c.base_power)}).`);
      continue;
    }
    if (line(o.base_power) !== line(c.base_power)) out.push(`**${n}** stats ${line(o.base_power)} → ${line(c.base_power)}.`);
    const oa = o.special_ability;
    const ca = c.special_ability;
    if ((oa?.ability_id ?? oa?.id) !== (ca?.ability_id ?? ca?.id) || oa?.description !== ca?.description) {
      out.push(`**${n}** ability changed: "${oa?.description ?? "none"}" → "${ca?.description ?? "none"}".`);
    }
    if (JSON.stringify(oa?.trigger_moments ?? oa?.triggerMoments ?? null) !== JSON.stringify(ca?.trigger_moments ?? ca?.triggerMoments ?? null)) {
      out.push(`**${n}** ability trigger changed.`);
    }
  }
  for (const n of a.keys()) if (!b.has(n)) out.push(`**${n}** removed from the draft pool.`);
  return out.length ? out : ["No card changes since the last report."];
}

interface Row {
  name: string;
  tier: string;
  stats: number;
  line: string;
  pts: number;
  se: number;
  ability: number | null;
  abilitySe: number | null;
  delta: number;
  prev?: number;
  prevSe?: number;
}

function rows(values: any, pool: any): Row[] {
  const lines = new Map<string, string>(pool.cards.map((c: any) => [c.base_card_data.name, line(c.base_card_data.base_power)]));
  const all: Row[] = Object.entries(values.cards).map(([name, c]: [string, any]) => ({
    name,
    tier: c.rarity,
    stats: c.stat_total,
    line: lines.get(name) ?? "",
    pts: c.card_pts,
    se: c.card_pts_se,
    ability: c.ability_pts,
    abilitySe: c.ability_pts_se,
    delta: 0,
  }));
  for (const t of TIERS) {
    const tier = all.filter((r) => r.tier === t);
    const m = median(tier.map((r) => r.pts));
    for (const r of tier) r.delta = r.pts - m;
  }
  return all;
}

function report(opts: { pool: any; values: any; prevValues: any | null; diff: string[]; play: any; simFresh: boolean }) {
  const { pool, values, prevValues, diff, play } = opts;
  const all = rows(values, pool);
  if (prevValues) {
    for (const r of all) {
      const p = prevValues.cards?.[r.name];
      if (p) {
        r.prev = p.card_pts;
        r.prevSe = p.card_pts_se;
      }
    }
  }
  // Confident means outside the band by more than two standard errors' worth of noise.
  const confident = (r: Row, band: number) => Math.abs(r.delta) > band && Math.abs(r.delta) - 2 * r.se > band - 2;
  const red = all.filter((r) => confident(r, FAR)).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const amber = all.filter((r) => !red.includes(r) && confident(r, NEAR)).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const commonsOff = all.filter((r) => r.tier === "common" && (r.stats < COMMON_STATS[0] || r.stats > COMMON_STATS[1]));
  const moved = all
    .filter((r) => r.prev !== undefined)
    .map((r) => ({ r, d: r.pts - (r.prev as number), noise: 2 * Math.hypot(r.se, r.prevSe ?? r.se) }))
    .filter((x) => Math.abs(x.d) >= 3 && Math.abs(x.d) > x.noise)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d));

  const medians = TIERS.map((t) => {
    const tier = all.filter((r) => r.tier === t);
    return { t, n: tier.length, m: median(tier.map((r) => r.pts)) };
  });

  const L: string[] = [];
  L.push(`# Balance report, ${DATE}`, "");
  L.push(
    `Prod draft pool (${pool.cards.length} cards, exported ${pool.exported_at.slice(0, 16).replace("T", " ")} UTC). ` +
      `Card values from ${values.games.toLocaleString("en-US")} self-play games (${values.agent ?? "agent unknown"}, fitted ${String(values.fitted_at).slice(0, 10)}${opts.simFresh ? "" : ", reused: run without --skip-sim for fresh numbers"}). ` +
      `Values are in stat points: +4 means the card plays like it has 4 extra stat points over its tier's median card.`,
    ""
  );
  L.push("**How to read this:** self-play is the strongest signal we have right now, but it's the AI playing, not people. Where the AI misplays a card (the report flags known cases), trust your own read. Nothing here is applied automatically.", "");

  L.push("## Needs attention", "");
  if (!red.length && !amber.length && !commonsOff.length) L.push("Nothing outside the targets this week.", "");
  for (const r of red) L.push(`- 🔴 **${r.name}** (${r.tier}, ${r.line}): ${sign(r.delta)} vs tier median (±${r.se.toFixed(1)}). Over the ±${FAR} hard limit.${hint(r)}`);
  for (const r of amber) L.push(`- 🟠 **${r.name}** (${r.tier}, ${r.line}): ${sign(r.delta)} vs tier median (±${r.se.toFixed(1)}). Outside ±${NEAR}; fine only if it's one of this tier's 1–2 signature cards.${hint(r)}`);
  if (commonsOff.length)
    L.push(
      `- 🟠 Commons outside the ${COMMON_STATS[0]}–${COMMON_STATS[1]} stat-total target: ${commonsOff
        .sort((a, b) => a.stats - b.stats)
        .map((r) => `${r.name} ${r.stats}`)
        .join(", ")}. Low totals are usually paid for by an ability, so check these against their value above before changing them.`
    );
  L.push("");

  L.push("## Changes since last report", "");
  for (const d of diff) L.push(`- ${d}`);
  L.push("");
  if (prevValues) {
    L.push("**Value shifts beyond noise** (from a card change, an ability bug fix, or a change to cards around it):", "");
    if (!moved.length) L.push("- None.");
    for (const x of moved) L.push(`- **${x.r.name}**: ${sign(x.r.prev as number)} → ${sign(x.r.pts)} (${sign(x.d)}).`);
    L.push("");
  }

  L.push("## Real play, last 7 days", "");
  if (play) {
    if (play.players !== null) L.push(`- Players who started a game: ${play.players}`);
    for (const m of play.byMode ?? []) L.push(`- ${m.mode}: ${m.games} games, ${m.finished} finished`);
    for (const d of play.drafts ?? []) L.push(`- Ranked draft ${d.vs_bot ? "vs practice bot" : "vs players"}: ${d.sessions} sessions`);
    L.push("");
    const cr: any[] | null = play.cardResults ?? null;
    if (cr === null) {
      L.push("Per-card win rates: `game_card_results` isn't on this database yet (migration 1800000000044).", "");
    } else if (cr.length === 0) {
      L.push("Per-card win rates: no card has 10+ played games in the last 30 days yet. `game_card_results` started recording with migration 1800000000044.", "");
    } else {
      L.push("### Real win rate when played, last 30 days (10+ games)", "", "| Card | Games | Win rate |", "|---|---:|---:|");
      for (const r of cr) L.push(`| ${r.card} | ${r.games} | ${Math.round((100 * r.wins) / r.games)}% |`);
      L.push("", "Small samples: treat as a hint next to the sim values, not a verdict.", "");
    }
  } else L.push("Skipped (no prod connection).", "");

  L.push("## Every card", "");
  L.push(`Tier medians: ${medians.map((x) => `${x.t} ${sign(x.m)} (${x.n})`).join(", ")}. "vs tier" is the card's value minus its tier's median.`, "");
  L.push("| Card | Tier | Stats | vs tier | ± | Ability worth | Last week |", "|---|---|---|---|---|---|---|");
  for (const t of TIERS) {
    for (const r of all.filter((x) => x.tier === t).sort((a, b) => b.delta - a.delta)) {
      const ab = r.ability === null ? "none" : `${sign(r.ability)} ±${(r.abilitySe ?? 0).toFixed(1)}`;
      const last = r.prev === undefined ? "" : sign(r.prev - (prevValues ? medianOf(prevValues, r.tier) : 0));
      L.push(`| ${r.name} | ${r.tier} | ${r.line} (${r.stats}) | ${sign(r.delta)} | ${r.se.toFixed(1)} | ${ab} | ${last} |`);
    }
  }
  L.push("");
  return L.join("\n");
}

function medianOf(values: any, tier: string) {
  return median(Object.values(values.cards ?? {}).filter((c: any) => c.rarity === tier).map((c: any) => c.card_pts));
}

/** Cards where self-play and expert play are known to disagree (strategy audit 2026-11-01). */
const AI_GAP = new Set(["Tyr", "Tsukuyomi", "Urashima Tarō", "Nurarihyon", "Jorōgumo", "Nightmarchers"]);
function hint(r: Row) {
  const parts: string[] = [];
  if (AI_GAP.has(r.name)) parts.push(" The AI is known to misplay this card, so this may be an AI gap, not a balance problem.");
  if (r.ability !== null && Math.abs(r.ability) > Math.abs(r.delta) * 0.6) parts.push(r.delta > 0 ? " Mostly the ability: weaken the ability before the stats." : " Mostly the ability: it may be hurting its own side.");
  else if (r.delta !== 0) parts.push(r.delta > 0 ? " Mostly stats: lower a side." : " Mostly stats: raise a side.");
  return parts.join("");
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  const prevDir = previousReport();
  const client = await connectReadOnly();
  let pool: any;
  let play: any = null;
  try {
    console.log("exporting the prod draft pool (read-only)");
    pool = await exportPool(client);
    play = await playStats(client);
  } finally {
    await client.end().catch(() => undefined);
  }
  const poolFile = path.join(DIR, "pool.json");
  fs.writeFileSync(poolFile, JSON.stringify(pool));
  const prevPool = prevDir ? JSON.parse(fs.readFileSync(path.join(prevDir, "pool.json"), "utf8")) : null;
  const prevValuesFile = prevDir ? path.join(prevDir, "values.json") : null;
  const prevValues = prevValuesFile && fs.existsSync(prevValuesFile) ? JSON.parse(fs.readFileSync(prevValuesFile, "utf8")) : null;

  const valuesFile = path.join(DIR, "values.json");
  let simFresh = true;
  if (SKIP_SIM) {
    if (!prevValues) throw new Error("--skip-sim needs an earlier report with values.json");
    fs.copyFileSync(prevValuesFile!, valuesFile);
    simFresh = false;
  } else {
    await simulate(poolFile, valuesFile);
  }
  const values = JSON.parse(fs.readFileSync(valuesFile, "utf8"));
  const md = report({ pool, values, prevValues: simFresh ? prevValues : null, diff: poolDiff(prevPool, pool), play, simFresh });
  fs.writeFileSync(path.join(DIR, "REPORT.md"), md);
  console.log(`DONE ${path.join(DIR, "REPORT.md")}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e?.message ?? e);
    process.exit(1);
  }
);
