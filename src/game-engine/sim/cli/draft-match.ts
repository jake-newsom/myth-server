/**
 * Drafter-vs-drafter harness: runs full simulated Ranked Drafts (ban, the
 * 1-2-2…-1 pick order, block), then plays the two resulting decks against
 * each other seat-swapped with the SAME game agent, so the score measures
 * drafting only.
 *
 *   TS_NODE_TRANSPILE_ONLY=true npx ts-node src/game-engine/sim/cli/draft-match.ts \
 *     --a bot --b auto --drafts 100 [--agent greedy] [--seed 1] \
 *     [--table content/ai/draft-card-values.json] [--strength 1] [--looseness 0] [--a-seat 2]
 *
 * --usage casual | <file.json>: draft popularity for the bot's ban/block
 * ("casual" = what noisy-auto drafters take; a file maps card id -> 0..1).
 *
 * Drafters: bot (the practice bot), auto (the live timeout auto-pick), random.
 * --a-seat 1|2 pins A's draft seat (the live bot always drafts second);
 * default alternates.
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

import { createAgent } from "../sim.agents";
import { playSimGame } from "../sim.game";
import {
  DraftPoolSnapshot,
  SimDrafter,
  autoDrafter,
  botDrafter,
  casualUsage,
  draftDeckSnapshot,
  mulberry32,
  noisyAutoDrafter,
  randomDrafter,
  simulateDraft,
  toPoolCard,
} from "../sim.draft";
import { DraftValueTable } from "../../draft/draftBot";

function makeDrafter(
  spec: string,
  table: DraftValueTable | null,
  strength: number,
  looseness: number,
  rand: () => number,
  usage?: ReadonlyMap<string, number>
): SimDrafter {
  if (spec === "bot") {
    return botDrafter(table, strength, looseness, rand, "bot", usage);
  }
  if (spec === "bot-notable") {
    return botDrafter(null, strength, looseness, rand, "bot-notable");
  }
  if (spec === "auto") return autoDrafter();
  if (spec === "noisy-auto") return noisyAutoDrafter(rand);
  if (spec === "random") return randomDrafter(rand);
  throw new Error(`unknown drafter ${spec} (bot, bot-notable, auto, noisy-auto, random)`);
}

async function main() {
  const drafts = Math.max(1, parseInt(opt("drafts", "100"), 10));
  const seed = parseInt(opt("seed", "1"), 10);
  const agentName = opt("agent", "greedy");
  const tablePath = opt("table", "content/ai/draft-card-values.json");
  const looseness = parseFloat(opt("looseness", "0"));
  const strength = parseFloat(opt("strength", "1"));
  const pinnedSeat = opt("a-seat", "");
  const poolSnap: DraftPoolSnapshot = JSON.parse(
    fs.readFileSync(path.resolve(opt("pool", ".ai-sim/draft-pool.json")), "utf8")
  );
  const table: DraftValueTable | null = fs.existsSync(tablePath)
    ? JSON.parse(fs.readFileSync(tablePath, "utf8"))
    : null;
  if (!table) console.log(`(no value table at ${tablePath}; bot uses stat fallback)`);

  const pool = poolSnap.cards.map(toPoolCard);
  const byId = new Map(poolSnap.cards.map((c) => [c.base_card_id, c]));
  const rand = mulberry32(seed);
  const usageSpec = opt("usage", "");
  const usage: Map<string, number> | undefined =
    usageSpec === "casual"
      ? casualUsage(pool, 500, mulberry32(seed + 7))
      : usageSpec
        ? new Map(Object.entries(JSON.parse(fs.readFileSync(path.resolve(usageSpec), "utf8"))))
        : undefined;
  const a = makeDrafter(opt("a", "bot"), table, strength, looseness, rand, usage);
  const b = makeDrafter(opt("b", "auto"), table, strength, looseness, rand, usage);
  const agent = createAgent(agentName);

  let points = 0;
  let scored = 0;
  let errors = 0;
  const started = Date.now();

  for (let i = 0; i < drafts; i++) {
    const aSeat = pinnedSeat ? parseInt(pinnedSeat, 10) : i % 2 === 0 ? 1 : 2;
    const draft =
      aSeat === 1 ? simulateDraft(pool, a, b) : simulateDraft(pool, b, a);
    const aKept = aSeat === 1 ? draft.p1Kept : draft.p2Kept;
    const bKept = aSeat === 1 ? draft.p2Kept : draft.p1Kept;
    const deckA = draftDeckSnapshot(a.name, aKept, byId);
    const deckB = draftDeckSnapshot(b.name, bKept, byId);

    for (const aIsP1 of [true, false]) {
      const r = await playSimGame({
        p1: agent,
        p2: agent,
        p1Deck: aIsP1 ? deckA : deckB,
        p2Deck: aIsP1 ? deckB : deckA,
        seed: seed * 1_000_003 + i,
      });
      if (r.outcome === "error") {
        errors++;
        continue;
      }
      scored++;
      const mine = aIsP1 ? "p1" : "p2";
      if (r.outcome === "draw") points += 0.5;
      else if (r.outcome === mine) points += 1;
    }
    if ((i + 1) % 10 === 0) {
      const rate = scored ? points / scored : 0;
      process.stdout.write(
        `\r${i + 1}/${drafts} drafts  ${a.name} ${(rate * 100).toFixed(1)}%  errors ${errors}  ${((Date.now() - started) / 1000).toFixed(0)}s   `
      );
    }
  }
  const rate = scored ? points / scored : 0;
  const ci = scored ? 1.96 * Math.sqrt((rate * (1 - rate)) / scored) : 0;
  console.log(
    `\n=== drafter ${a.name} vs ${b.name} — ${drafts} drafts, ${scored} games, agent ${agentName}, strength ${strength}, looseness ${looseness}${pinnedSeat ? `, A drafts seat ${pinnedSeat}` : ""}${usageSpec ? `, usage ${usageSpec}` : ""} ===`
  );
  console.log(`${a.name} deck score: ${(rate * 100).toFixed(1)}% ± ${(ci * 100).toFixed(1)}%  (errors ${errors})`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
