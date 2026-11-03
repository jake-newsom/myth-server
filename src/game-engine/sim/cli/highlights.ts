/**
 * Finds the plays Myth Studio turns into videos, and writes each one as a
 * self-contained replay: board before, the real engine event list, board after.
 *
 *   # Mine real self-play for each card's biggest moments
 *   npx ts-node --transpile-only src/game-engine/sim/cli/highlights.ts mine --seconds 180
 *
 *   # Search for the maximum play one card can make (engine-validated)
 *   npx ts-node --transpile-only src/game-engine/sim/cli/highlights.ts setup --card "Ryūjin"
 *   npx ts-node --transpile-only src/game-engine/sim/cli/highlights.ts setup --all
 *
 * Headless: the database is stubbed to throw, and card data comes from the prod
 * pool export. Every replay comes from GameLogic.placeCard, so a video can never
 * show a play the real rules wouldn't allow.
 */
import * as fs from "fs";
import * as path from "path";
import * as _ from "lodash";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const db = require("../../../config/db.config").default;
db.query = async () => {
  throw new Error("DB access during headless sim");
};

/* eslint-disable @typescript-eslint/no-var-requires */
const { createAgent } = require("../sim.agents");
const { playSimGame, createSimGame, SIM_P1, SIM_P2 } = require("../sim.game");
const {
  draftDeckSnapshot,
  mulberry32,
  randomDrafter,
  simulateDraft,
  toPoolCard,
} = require("../sim.draft");
const { GameLogic, GameStatus } = require("../../game.logic");
const { simulationContext } = require("../../simulation.context");
const validators = require("../../game.validators");
/* eslint-enable @typescript-eslint/no-var-requires */

const args = process.argv.slice(2);
const command = args[0] ?? "mine";
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const flag = (name: string) => args.includes(`--${name}`);

const SERVER_ROOT = path.resolve(__dirname, "../../../..");
const POOL_FILE = opt(
  "pool",
  path.join(SERVER_ROOT, ".ai-sim/draft-pool-prod.json")
);
const OUT_DIR = opt(
  "out",
  path.resolve(SERVER_ROOT, "../myth/studio/data/highlights")
);
const AGENT = opt("agent", "greedy-eps");
const BASE_SEED = parseInt(opt("seed", "20261101"), 10);

const snapshot = JSON.parse(fs.readFileSync(POOL_FILE, "utf8"));
const pool = snapshot.cards.map(toPoolCard);
const byBaseId = new Map<string, any>(
  snapshot.cards.map((c: any) => [c.base_card_id, c])
);

/** Thin copy of a card: only what the video needs to draw it. */
function cardView(card: any) {
  const data = card.base_card_data;
  return {
    id: card.user_card_instance_id,
    name: data.name,
    rarity: data.rarity,
    image_url: data.image_url,
    tags: data.tags ?? [],
    set_id: data.set_id,
    base_power: data.base_power,
    current_power: card.current_power,
    owner: card.owner,
    ability: data.special_ability
      ? {
          id: data.special_ability.id,
          name: data.special_ability.name,
          description: data.special_ability.description,
        }
      : null,
    sound_effect: data.sound_effect ?? null,
    // The full card, so the client's real GameCard can draw it unchanged.
    base_card_id: card.base_card_id,
    base_card_data: data,
    level: card.level ?? 1,
    power_enhancements: card.power_enhancements ?? {},
  };
}

function boardView(state: any) {
  return state.board.map((row: any[]) =>
    row.map((cell: any) => ({
      card: cell.card ? cardView(cell.card) : null,
      enabled: cell.tile_enabled !== false,
      effect: cell.tile_effect?.status ?? null,
    }))
  );
}

function scores(state: any) {
  const s = validators.calculateScores(state.board, SIM_P1, SIM_P2);
  return { p1: s.player1Score, p2: s.player2Score };
}

function handView(state: any, playerId: string) {
  const player = validators.getPlayer(state, playerId);
  return player.hand
    .map((id: string) => state.hydrated_card_data_cache?.[id])
    .filter(Boolean)
    .map(cardView);
}

/** Keeps the fields the scene animates and drops engine-only payload. */
function trimEvent(e: any) {
  const keep = [
    "type",
    "delayAfterMs",
    "sourcePlayerId",
    "animation",
    "soundEffect",
    "position",
    "cardId",
    "clash",
    "powerDelta",
    "powerBySide",
    "effectName",
    "abilityName",
    "abilityId",
    "isDebuff",
    "powerOnPlace",
    "newOwner",
    "fromPosition",
    "toPosition",
    "sourceCardId",
    "targetPlayerId",
    "player1Score",
    "player2Score",
    "winner",
  ];
  const out: any = {};
  for (const k of keep) if (e[k] !== undefined) out[k] = e[k];
  return out;
}

interface Measured {
  /** Tiles the opponent held before this move and the mover holds after it. */
  flips: number;
  /** Of those, tiles not orthogonally adjacent to the placed card. */
  remote: number;
  /** Flips the placed card caused itself: its ability or its own combat. */
  heroFlips: number;
  /** Flips caused by anything else, so "one card did this" would be false. */
  otherFlips: number;
  /** Flip events beyond the net result: flip-backs and chain churn. */
  chaos: number;
  defended: number;
  buffed: number;
  debuffed: number;
  destroyed: number;
  swing: number;
  before: { p1: number; p2: number };
  after: { p1: number; p2: number };
  deficit: number;
  won: boolean;
  finished: boolean;
}

function measure(m: {
  before: any;
  after: any;
  playerId: string;
  position: { x: number; y: number };
  events: any[];
}): Measured {
  let flips = 0;
  let remote = 0;
  m.after.board.forEach((row: any[], y: number) =>
    row.forEach((cell: any, x: number) => {
      const was = m.before.board[y][x].card;
      if (!was || was.owner === m.playerId) return;
      if (cell.card?.owner !== m.playerId) return;
      flips++;
      if (Math.abs(x - m.position.x) + Math.abs(y - m.position.y) > 1) remote++;
    })
  );
  const flipList = m.events.filter((e) => e.type === "CARD_FLIPPED");
  const flipEvents = flipList.length;
  const heroId = m.before.board[m.position.y][m.position.x].card
    ? null
    : (m.events.find((e) => e.type === "CARD_PLACED")?.cardId ?? null);
  const heroFlips = flipList.filter(
    (e) =>
      (e.sourceCardId && e.sourceCardId === heroId) ||
      (e.clash?.attacker?.x === m.position.x &&
        e.clash?.attacker?.y === m.position.y)
  ).length;
  const before = scores(m.before);
  const after = scores(m.after);
  const mine = (s: { p1: number; p2: number }) =>
    m.playerId === SIM_P1 ? s.p1 - s.p2 : s.p2 - s.p1;
  const finished = m.after.status !== GameStatus.ACTIVE;
  return {
    flips,
    remote,
    heroFlips,
    otherFlips: flipEvents - heroFlips,
    chaos: Math.max(0, flipEvents - flips),
    defended: m.events.filter((e) => e.type === "CARD_DEFENDED").length,
    buffed: m.events.filter(
      (e) => e.type === "CARD_POWER_CHANGED" && (e.powerDelta ?? 0) > 0
    ).length,
    debuffed: m.events.filter(
      (e) => e.type === "CARD_POWER_CHANGED" && (e.powerDelta ?? 0) < 0
    ).length,
    destroyed: m.events.filter((e) => e.type === "CARD_REMOVED_FROM_BOARD")
      .length,
    swing: mine(after) - mine(before),
    before,
    after,
    deficit: Math.max(0, -mine(before)),
    won: m.after.winner === m.playerId,
    finished,
  };
}

/** How good a clip this play would make. Tunable; only used for ranking. */
function excitement(s: Measured, tier: string) {
  return (
    s.heroFlips * 10 +
    s.otherFlips * 3 +
    s.remote * 6 +
    s.destroyed * 6 +
    Math.min(s.debuffed, 4) +
    Math.min(s.buffed, 4) +
    s.deficit * 2 +
    (s.won && s.finished ? 8 : 0) +
    (tier.startsWith("legendary") ? 2 : 0) -
    s.chaos * 8
  );
}

function replay(kind: "real" | "setup", m: any, extra: Record<string, unknown>) {
  const card = m.before.hydrated_card_data_cache[m.cardId];
  const stats = measure(m);
  const data = card.base_card_data;
  const slug = data.name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  return {
    // Stable per card and rank, so a newer run replaces the older replay.
    id: `${kind}-${slug}-${extra.tag ?? "0"}`,
    kind,
    card: cardView(card),
    mover: m.playerId,
    position: m.position,
    stats,
    score: excitement(stats, String(data.rarity)),
    before: {
      board: boardView(m.before),
      hand: handView(m.before, m.playerId),
      opponentHandSize: validators.getPlayer(
        m.before,
        m.playerId === SIM_P1 ? SIM_P2 : SIM_P1
      ).hand.length,
      turn: m.before.turn_number,
    },
    after: {
      board: boardView(m.after),
      status: m.after.status,
      winner: m.after.winner ?? null,
    },
    events: m.events.map(trimEvent),
    source: {
      pool: POOL_FILE.split("/").pop(),
      pool_exported_at: snapshot.exported_at,
      generated_at: new Date().toISOString(),
      ...extra,
    },
  };
}

function save(r: any) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, `${r.id}.json`), JSON.stringify(r));
}

// ── Mine real games ─────────────────────────────────────────────────────────

async function mine() {
  const seconds = parseInt(opt("seconds", "180"), 10);
  const perCard = parseInt(opt("per-card", "2"), 10);
  const agent = createAgent(AGENT);
  const best = new Map<string, any[]>();
  // Comebacks: from at least 3 behind to level or ahead in one move.
  const comebacks: Array<{ value: number; m: any; game: number }> = [];
  const COMEBACKS = 8;
  const started = Date.now();
  let games = 0;
  let errors = 0;

  while ((Date.now() - started) / 1000 < seconds) {
    const i = games++;
    const rand = mulberry32(BASE_SEED + i * 7919);
    const draft = simulateDraft(pool, randomDrafter(rand), randomDrafter(rand));
    const result = await playSimGame({
      p1: agent,
      p2: agent,
      p1Deck: draftDeckSnapshot("a", draft.p1Kept, byBaseId),
      p2Deck: draftDeckSnapshot("b", draft.p2Kept, byBaseId),
      seed: BASE_SEED + i,
      onMove: (m: any) => {
        if (!m.events.some((e: any) => e.type === "CARD_FLIPPED")) return;
        const card = m.before.hydrated_card_data_cache[m.cardId];
        const name = card.base_card_data.name;
        const measured = measure(m);
        const value = excitement(measured, String(card.base_card_data.rarity));
        const mine = (x: { p1: number; p2: number }) => (m.playerId === SIM_P1 ? x.p1 - x.p2 : x.p2 - x.p1);
        if (measured.deficit >= 3 && mine(measured.after) >= 0 && measured.otherFlips === 0) {
          const cb = measured.deficit * 10 + mine(measured.after) * 4 + measured.flips + (measured.won && measured.finished ? 8 : 0);
          if (comebacks.length < COMEBACKS || cb > comebacks[comebacks.length - 1].value) {
            comebacks.push({ value: cb, m, game: i });
            comebacks.sort((a, b) => b.value - a.value);
            comebacks.length = Math.min(comebacks.length, COMEBACKS);
          }
        }
        const list = best.get(name) ?? [];
        if (list.length >= perCard && value <= list[list.length - 1].value) return;
        list.push({ value, m, game: i });
        list.sort((a, b) => b.value - a.value);
        best.set(name, list.slice(0, perCard));
      },
    });
    if (result.outcome === "error") errors++;
    if (games % 100 === 0) {
      const pct = Math.min(100, Math.round(((Date.now() - started) / 10) / seconds));
      console.log(`PROGRESS ${pct} ${games} games`);
    }
  }

  let written = 0;
  for (const list of best.values()) {
    for (const [rank, entry] of list.entries()) {
      save(
        replay("real", entry.m, {
          tag: rank + 1,
          game: entry.game,
          seed: BASE_SEED + entry.game,
          agent: AGENT,
          match_type: "bot self-play",
        })
      );
      written++;
    }
  }
  // Each run's comebacks are tagged by the run, so last week's stay in the library.
  const runTag = (BASE_SEED % 100000).toString(36);
  comebacks.forEach((entry, rank) => {
    save(
      replay("real", entry.m, {
        tag: `cb${runTag}-${rank + 1}`,
        game: entry.game,
        seed: BASE_SEED + entry.game,
        agent: AGENT,
        match_type: "bot self-play",
        comeback: true,
      })
    );
    written++;
  });
  console.log(
    `DONE games=${games} errors=${errors} cards=${best.size} comebacks=${comebacks.length} replays=${written} out=${OUT_DIR}`
  );
}

/**
 * Replays one saved real-game highlight through the CURRENT engine: same pool,
 * draft and game seed, so the game is identical up to that move. Use after an
 * ability fix so its videos show the corrected play. Saves under the same id.
 *   regame --from <replay.json>
 */
async function regame() {
  const file = opt("from", "");
  if (!file) throw new Error("regame needs --from <replay.json>");
  const old = JSON.parse(fs.readFileSync(file, "utf8"));
  const src = old.source ?? {};
  if (old.kind !== "real" || typeof src.game !== "number" || typeof src.seed !== "number")
    throw new Error("Only mined (real) replays with a recorded game and seed can be replayed");
  const base = src.seed - src.game;
  const i = src.game;
  const rand = mulberry32(base + i * 7919);
  const draft = simulateDraft(pool, randomDrafter(rand), randomDrafter(rand));
  const agent = createAgent(src.agent ?? AGENT);
  let found: any = null;
  await playSimGame({
    p1: agent,
    p2: agent,
    p1Deck: draftDeckSnapshot("a", draft.p1Kept, byBaseId),
    p2Deck: draftDeckSnapshot("b", draft.p2Kept, byBaseId),
    seed: src.seed,
    onMove: (m: any) => {
      if (!found && m.cardId === old.card.id && m.playerId === old.mover && m.before.turn_number === old.before.turn) found = m;
    },
  });
  if (!found) throw new Error(`The game no longer reaches that move (${old.card.name}, turn ${old.before.turn})`);
  const { pool: _p, pool_exported_at: _e, generated_at: _g, ...extra } = src;
  const r = replay("real", found, extra);
  if (r.id !== old.id) throw new Error(`Replayed id ${r.id} doesn't match ${old.id}`);
  save(r);
  console.log(`DONE ${r.id} flips=${r.stats.flips} destroyed=${r.stats.destroyed}`);
}

// ── Build perfect setups ────────────────────────────────────────────────────

function hydrate(base: any, seat: string, tag: string) {
  const c = _.cloneDeep(base);
  const id = `${seat}:${tag}`;
  c.user_card_instance_id = id;
  c.owner = seat;
  c.original_owner = seat;
  c.current_power = { ...c.base_card_data.base_power };
  return c;
}

const totalPower = (c: any) => {
  const p = c.base_card_data.base_power;
  return p.top + p.right + p.bottom + p.left;
};

function emptyDeck(name: string) {
  return { deck_id: name, name, source: "ai", deck_effect: null, cards: [] };
}

/**
 * A plausible late-game position: every tile assignment is explicit, and the
 * engine then decides what the placement actually does.
 */
function buildState(plan: {
  hero: any;
  position: { x: number; y: number };
  tiles: Map<string, { base: any; seat: string }>;
  hand: any[];
  oppHand: any[];
}) {
  const state: any = createSimGame(emptyDeck("a"), emptyDeck("b"), BASE_SEED);
  state.status = GameStatus.ACTIVE;
  state.current_player_id = SIM_P1;
  state.turn_number = plan.tiles.size + 1;
  state.mulligan_state = undefined;
  const cache: any = {};
  const heroCard = hydrate(plan.hero, SIM_P1, "hero");
  cache[heroCard.user_card_instance_id] = heroCard;

  let n = 0;
  for (const [key, entry] of plan.tiles) {
    const [x, y] = key.split(",").map(Number);
    const c = hydrate(entry.base, entry.seat, `board${n++}`);
    cache[c.user_card_instance_id] = c;
    state.board[y][x].card = c;
  }
  const handIds = plan.hand.map((b, i) => {
    const c = hydrate(b, SIM_P1, `hand${i}`);
    cache[c.user_card_instance_id] = c;
    return c.user_card_instance_id;
  });
  const oppIds = plan.oppHand.map((b, i) => {
    const c = hydrate(b, SIM_P2, `opp${i}`);
    cache[c.user_card_instance_id] = c;
    return c.user_card_instance_id;
  });
  state.player1.hand = [heroCard.user_card_instance_id, ...handIds];
  state.player2.hand = oppIds;
  state.player1.deck = [];
  state.player2.deck = [];
  state.hydrated_card_data_cache = cache;
  return { state, heroId: heroCard.user_card_instance_id };
}

async function tryPlan(plan: Parameters<typeof buildState>[0], seed: number) {
  const { state, heroId } = buildState(plan);
  try {
    let result: any;
    await simulationContext.withSimulation(async () => {
      result = await GameLogic.placeCard(state, SIM_P1, heroId, plan.position);
    }, seed);
    const m = {
      before: state,
      after: result.state,
      playerId: SIM_P1,
      cardId: heroId,
      position: plan.position,
      events: result.events,
    };
    return { m, stats: measure(m) };
  } catch {
    return null;
  }
}

async function setupFor(heroBase: any, budgetMs: number) {
  const rand = mulberry32(BASE_SEED ^ heroBase.base_card_data.name.length * 104729);
  const pick = <T>(items: T[]) => items[Math.floor(rand() * items.length)];
  const others = snapshot.cards.filter(
    (c: any) => c.base_card_data.name !== heroBase.base_card_data.name
  );
  const weak = [...others].sort((a: any, b: any) => totalPower(a) - totalPower(b));
  const SIZE = 4;

  const fitness = (s: Measured, plan: any, eventCount: number) => {
    // A clean, readable play wins: net captures dominate, churn is punished
    // hard, and a stronger defeated field reads as more impressive.
    let enemyPower = 0;
    for (const t of plan.tiles.values())
      if (t.seat === SIM_P2) enemyPower += totalPower(t.base);
    return (
      s.heroFlips * 1000 -
      s.otherFlips * 100000 +
      s.remote * 150 +
      s.destroyed * 200 -
      s.chaos * 900 -
      eventCount * 70 +
      Math.min(s.debuffed, 4) * 40 +
      Math.min(s.buffed, 4) * 20 +
      (s.won ? 400 : 0) +
      Math.min(s.deficit, 8) * 10 +
      enemyPower * 0.15
    );
  };

  /** A seat can't hold more copies of a card than a real deck allows. */
  const legal = (plan: any) => {
    const count = new Map<string, number>();
    const add = (seat: string, base: any) => {
      const key = `${seat}:${base.base_card_data.name}`;
      count.set(key, (count.get(key) ?? 0) + 1);
    };
    add(SIM_P1, plan.hero);
    for (const t of plan.tiles.values()) add(t.seat, t.base);
    for (const b of plan.hand) add(SIM_P1, b);
    for (const b of plan.oppHand) add(SIM_P2, b);
    // Turn order keeps a real board roughly even; flips can tilt it, not erase it.
    let enemies = 0;
    let allies = 0;
    for (const t of plan.tiles.values()) t.seat === SIM_P2 ? enemies++ : allies++;
    if (enemies > 9 || allies < enemies - 4) return false;
    return [...count.values()].every((n) => n <= 2);
  };

  const randomPlan = () => {
    const position = { x: Math.floor(rand() * SIZE), y: Math.floor(rand() * SIZE) };
    const tiles = new Map<string, { base: any; seat: string }>();
    const coords: Array<[number, number]> = [];
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++)
        if (x !== position.x || y !== position.y) coords.push([x, y]);
    coords.sort(() => rand() - 0.5);
    // A full board has 8 enemy cards and 7 of ours when the hero lands last.
    const filled = 11 + Math.floor(rand() * 5);
    const enemies = Math.ceil(filled / 2) + Math.floor(rand() * 2);
    coords.slice(0, filled).forEach(([x, y], i) => {
      const seat = i < enemies ? SIM_P2 : SIM_P1;
      const source = rand() < 0.75 ? weak.slice(0, 45) : others;
      tiles.set(`${x},${y}`, { base: pick(source), seat });
    });
    return {
      hero: heroBase,
      position,
      tiles,
      hand: [pick(others), pick(others), pick(others), pick(others)],
      oppHand: [pick(others), pick(others), pick(others)],
    };
  };

  const clonePlan = (p: any) => ({
    ...p,
    position: { ...p.position },
    tiles: new Map(p.tiles),
    hand: [...p.hand],
    oppHand: [...p.oppHand],
  });

  const started = Date.now();
  let best: any = null;
  let tries = 0;

  // Broad random search, then hill-climb on the best position.
  while (Date.now() - started < budgetMs * 0.4) {
    const plan = randomPlan();
    if (!legal(plan)) continue;
    const r = await tryPlan(plan, BASE_SEED + tries++);
    if (!r) continue;
    const f = fitness(r.stats, plan, r.m.events.length);
    if (!best || f > best.f) best = { f, plan, r };
  }
  if (!best) return null;

  while (Date.now() - started < budgetMs) {
    const plan = clonePlan(best.plan);
    const keys = [...plan.tiles.keys()] as string[];
    const edit = rand();
    const key = pick(keys);
    if (edit < 0.55) {
      plan.tiles.set(key, {
        ...plan.tiles.get(key)!,
        base: pick(rand() < 0.5 ? weak.slice(0, 45) : others),
      });
    } else if (edit < 0.8) {
      const t: any = plan.tiles.get(key)!;
      plan.tiles.set(key, { ...t, seat: t.seat === SIM_P1 ? SIM_P2 : SIM_P1 });
    } else {
      plan.hand[Math.floor(rand() * plan.hand.length)] = pick(others);
    }
    if (!legal(plan)) continue;
    const r = await tryPlan(plan, BASE_SEED + tries++);
    if (!r) continue;
    const f = fitness(r.stats, plan, r.m.events.length);
    if (f >= best.f) best = { f, plan, r };
  }
  console.log(
    `SETUP ${heroBase.base_card_data.name}: flips=${best.r.stats.flips} hero=${best.r.stats.heroFlips} remote=${best.r.stats.remote} chaos=${best.r.stats.chaos} events=${best.r.m.events.length} ` +
      `destroyed=${best.r.stats.destroyed} swing=${best.r.stats.swing} tries=${tries}`
  );
  return replay("setup", best.r.m, {
    tag: "max",
    match_type: "constructed setup",
    search_tries: tries,
  });
}

async function setup() {
  const seconds = parseInt(opt("seconds", "15"), 10);
  const name = opt("card", "");
  const targets = flag("all")
    ? snapshot.cards.filter((c: any) => c.base_card_data.special_ability)
    : snapshot.cards.filter((c: any) => c.base_card_data.name === name);
  if (targets.length === 0) throw new Error(`No card named "${name}" in the pool`);
  let done = 0;
  for (const hero of targets) {
    const r = await setupFor(hero, seconds * 1000);
    if (r) save(r);
    done++;
    console.log(`PROGRESS ${Math.round((done / targets.length) * 100)} ${hero.base_card_data.name}`);
  }
  console.log(`DONE setups=${done} out=${OUT_DIR}`);
}

// ── Weekly Riddle: replay the stored answer line through the engine ─────────

/**
 * Reads raw riddle weeks (from scripts/studio-data.ts riddles) and replays the
 * winning line (first move, the oracle's most dangerous reply, a winning final
 * move) under the week's seed, exactly as the riddle service grades it. Seats
 * are renamed sim-p1 (player) and sim-p2 (oracle) for the scene.
 */
async function riddleWeeks() {
  const RIDDLE_PLAYER = "riddle-player";
  const RIDDLE_ORACLE = "riddle-oracle";
  const { moveKey } = require("../../riddle.solver");
  const inDir = opt("in", path.resolve(SERVER_ROOT, "../myth/studio/data/riddles/raw"));
  const outDir = opt("riddle-out", path.resolve(inDir, ".."));
  const files = fs.readdirSync(inDir).filter((f) => /^week-\d+\.json$/.test(f));

  const toSim = (v: any) => {
    const json = JSON.stringify(v, (k, val) => (k === "sourceCard" ? undefined : val));
    return JSON.parse(
      json
        .split(`"${RIDDLE_PLAYER}"`).join(`"${SIM_P1}"`)
        .split(`"${RIDDLE_PLAYER}:`).join(`"${SIM_P1}:`)
        .split(`"${RIDDLE_ORACLE}"`).join(`"${SIM_P2}"`)
        .split(`"${RIDDLE_ORACLE}:`).join(`"${SIM_P2}:`)
    );
  };
  const riddleScores = (s: any) => {
    const r = validators.calculateScores(s.board, RIDDLE_PLAYER, RIDDLE_ORACLE);
    return { p1: r.player1Score, p2: r.player2Score };
  };
  const hand = (s: any, seat: string) =>
    validators.getPlayer(s, seat).hand.map((id: string) => cardView(s.hydrated_card_data_cache[id]));

  for (const f of files) {
    const week = JSON.parse(fs.readFileSync(path.join(inDir, f), "utf8"));
    const entry: any = Object.values(week.answer_table).find((a: any) => a.correct);
    if (!entry) {
      console.log(`SKIP ${f}: no correct first move`);
      continue;
    }
    const out = await simulationContext.withSimulation(async () => {
      let state = _.cloneDeep(week.state);
      const initial = {
        board: boardView(state),
        hand: hand(state, RIDDLE_PLAYER),
        oracleHand: hand(state, RIDDLE_ORACLE),
        scores: riddleScores(state),
      };
      const moves: any[] = [];
      const play = async (m: { cardId: string; position: { x: number; y: number } }, role: string) => {
        const mover = state.current_player_id;
        const card = state.hydrated_card_data_cache[m.cardId];
        const placed = await GameLogic.placeCard(_.cloneDeep(state), mover, m.cardId, m.position);
        let s = placed.state;
        const events = [...placed.events];
        if (s.pending_choice) {
          const resolved = await GameLogic.resolveHandChoice(s, GameLogic.pickStrongestPendingChoiceCards(s));
          s = resolved.state;
          events.push(...resolved.events);
        }
        for (let i = 0; i < 4 && s.status === GameStatus.ACTIVE; i++) {
          if (validators.canPlayerPlay(validators.getPlayer(s, s.current_player_id))) break;
          const passed = await GameLogic.forcePass(s, s.current_player_id);
          s = passed.state;
          events.push(...passed.events);
        }
        moves.push({
          role,
          mover,
          card: cardView(card),
          position: m.position,
          events: events.map(trimEvent),
          after: { board: boardView(s), status: s.status, winner: s.winner ?? null },
          scores: riddleScores(s),
        });
        state = s;
      };
      await play(entry.first, "first");
      if (entry.reply && state.status === GameStatus.ACTIVE) await play(entry.reply, "reply");
      if (state.status === GameStatus.ACTIVE) {
        const me = validators.getPlayer(state, RIDDLE_PLAYER);
        const wanted = new Set(entry.winningFinals);
        let final: any = null;
        for (const id of me.hand) {
          for (const key of wanted) {
            const [, , xy] = String(key).split("|");
            const [x, y] = xy.split(",").map(Number);
            const m = { cardId: id, position: { x, y } };
            if (moveKey(state, m) === key) final = m;
          }
          if (final) break;
        }
        if (!final) throw new Error(`${f}: no card in hand matches a winning final move`);
        await play(final, "final");
      }
      return { initial, moves, winner: state.winner ?? null, status: state.status, final: riddleScores(state) };
    }, Number(week.seed));

    const won = out.winner === RIDDLE_PLAYER;
    const r = toSim({
      id: `riddle-week-${week.week_number}`,
      kind: "riddle",
      week: week.week_number,
      release_at: week.release_at,
      ends_at: week.ends_at,
      solution: week.solution,
      ...out,
      won,
      source: { generated_at: new Date().toISOString(), seed: String(week.seed) },
    });
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `${r.id}.json`), JSON.stringify(r));
    console.log(`RIDDLE week ${week.week_number}: moves=${out.moves.length} won=${won} final=${out.final.p1}-${out.final.p2}`);
  }
  console.log(`DONE riddles=${files.length}`);
}

(command === "setup" ? setup() : command === "riddle" ? riddleWeeks() : command === "regame" ? regame() : mine())
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
