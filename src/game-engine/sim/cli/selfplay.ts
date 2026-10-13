/**
 * Generates value-network training data from headless self-play.
 *
 *   npx ts-node src/game-engine/sim/cli/selfplay.ts \
 *     --a greedy-eps --b greedy-eps --games 2000 --shard 0 [--out .ai-sim/data]
 *
 * Every ACTIVE position (no pending choice) is encoded from BOTH players'
 * perspectives and labelled with that player's final result, so each game
 * yields ~2 × turns samples. Run several shards in parallel with different
 * --shard values; each shard uses its own seed range.
 *
 * Output per shard (little-endian, fixed-size rows; see <shard>.meta.json):
 *   <shard>.f32  float32 rows: tiles | hand | scalars | oppUnseen | myDeck | z | margin
 *   <shard>.i16  int16 rows:   tileAbility | tileCharacter | handAbility | handCharacter
 */
import * as fs from "fs";
import * as path from "path";

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
import { GameStatus } from "../../game.logic";
import { DeckPool } from "../sim.types";
import { createAgent } from "../sim.agents";
import { playSimGame, SIM_P1, SIM_P2 } from "../sim.game";
import {
  buildVocab,
  EncodedState,
  EncoderVocab,
  StateEncoder,
} from "../sim.encoder";

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let n = Math.imul(t ^ (t >>> 15), 1 | t);
    n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

function floatRow(e: EncodedState, z: number, margin: number): number[] {
  return [
    ...e.tiles,
    ...e.hand,
    ...e.scalars,
    ...e.oppUnseenAbilities,
    ...e.myDeckAbilities,
    z,
    margin,
  ];
}

function intRow(e: EncodedState): number[] {
  return [...e.tileAbility, ...e.tileCharacter, ...e.handAbility, ...e.handCharacter];
}

async function main() {
  const games = parseInt(opt("games", "500"), 10);
  const shard = parseInt(opt("shard", "0"), 10);
  const outDir = path.resolve(opt("out", ".ai-sim/data"));
  const poolPath = path.resolve(opt("pool", ".ai-sim/deck-pool.json"));
  const vocabPath = path.resolve(opt("vocab", ".ai-sim/vocab.json"));

  const pool: DeckPool = JSON.parse(fs.readFileSync(poolPath, "utf8"));

  // The vocab is frozen on first use: model weights index into it, so it must
  // not silently reorder when the deck pool is re-exported.
  let vocab: EncoderVocab;
  if (fs.existsSync(vocabPath)) {
    vocab = JSON.parse(fs.readFileSync(vocabPath, "utf8"));
  } else {
    vocab = buildVocab(pool);
    fs.mkdirSync(path.dirname(vocabPath), { recursive: true });
    fs.writeFileSync(vocabPath, JSON.stringify(vocab, null, 1));
  }
  const encoder = new StateEncoder(vocab);

  const a = createAgent(opt("a", "greedy-eps"));
  const b = createAgent(opt("b", "greedy-eps"));

  fs.mkdirSync(outDir, { recursive: true });
  const base = path.join(outDir, `shard-${shard}`);
  const fFd = fs.openSync(`${base}.f32`, "w");
  const iFd = fs.openSync(`${base}.i16`, "w");

  const pick = mulberry32(1_000_003 * (shard + 1));
  let rows = 0;
  let floatDim = 0;
  let intDim = 0;
  let errors = 0;
  const started = Date.now();

  for (let g = 0; g < games; g++) {
    const seed = shard * 10_000_000 + g;
    const d1 = pool.decks[Math.floor(pick() * pool.decks.length)];
    const d2 = pool.decks[Math.floor(pick() * pool.decks.length)];
    const aIsP1 = g % 2 === 0;

    const positions: { p1: EncodedState; p2: EncodedState }[] = [];
    const result = await playSimGame({
      p1: aIsP1 ? a : b,
      p2: aIsP1 ? b : a,
      p1Deck: d1,
      p2Deck: d2,
      seed,
      onState: (state: GameState) => {
        if (state.status !== GameStatus.ACTIVE || state.pending_choice) return;
        positions.push({
          p1: encoder.encode(state, SIM_P1),
          p2: encoder.encode(state, SIM_P2),
        });
      },
    });
    if (result.outcome === "error") {
      errors++;
      continue;
    }

    const zP1 = result.outcome === "p1" ? 1 : result.outcome === "p2" ? -1 : 0;
    const marginP1 = (result.p1Score - result.p2Score) / 16;
    const floats: number[] = [];
    const ints: number[] = [];
    for (const pos of positions) {
      for (const [e, z, m] of [
        [pos.p1, zP1, marginP1],
        [pos.p2, -zP1, -marginP1],
      ] as const) {
        const fr = floatRow(e, z, m);
        const ir = intRow(e);
        floatDim ||= fr.length;
        intDim ||= ir.length;
        floats.push(...fr);
        ints.push(...ir);
        rows++;
      }
    }
    fs.writeSync(fFd, Buffer.from(new Float32Array(floats).buffer));
    fs.writeSync(iFd, Buffer.from(new Int16Array(ints).buffer));

    if ((g + 1) % 100 === 0) {
      const secs = (Date.now() - started) / 1000;
      console.log(
        `[shard ${shard}] ${g + 1}/${games} games, ${rows} rows, ${errors} errors, ${((g + 1) / secs).toFixed(1)} g/s`
      );
    }
  }

  fs.closeSync(fFd);
  fs.closeSync(iFd);
  fs.writeFileSync(
    `${base}.meta.json`,
    JSON.stringify(
      {
        encoder_version: vocab.version,
        rows,
        float_dim: floatDim,
        int_dim: intDim,
        board_tiles: 16,
        tile_features: 22,
        hand_slots: 10,
        hand_features: 9,
        scalar_count: encoder.scalarCount,
        ability_vocab: encoder.abilityVocabSize,
        character_vocab: encoder.characterVocabSize,
        agents: [a.name, b.name],
        games,
        errors,
      },
      null,
      1
    )
  );
  console.log(`[shard ${shard}] done: ${rows} rows → ${base}.*`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
