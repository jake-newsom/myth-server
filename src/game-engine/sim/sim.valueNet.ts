import * as fs from "fs";
import { EncodedState, ENCODER_VERSION } from "./sim.encoder";

/**
 * Pure-TS forward pass for the value network trained by
 * ai-train/train_value.py. Mirrors ValueNet.forward exactly; change both
 * together. No native deps, so it can run inside the game server as-is.
 *
 * It runs once per searched position, so it avoids per-call allocation:
 * weights are flattened into Float32Arrays up front, and each embedding's
 * contribution to the tile/hand layers (W_emb · embedding[id]) is
 * precomputed per vocab id, turning those lookups into vector adds.
 */
export interface ValueNetFile {
  encoder_version: number;
  dims: {
    board_tiles: number;
    tile_features: number;
    hand_slots: number;
    hand_features: number;
    scalar_count: number;
    ability_vocab: number;
    character_vocab: number;
  };
  weights: Record<string, any>;
}

interface Dense {
  w: Float32Array; // [out × in], row-major (PyTorch layout)
  b: Float32Array;
  out: number;
  in: number;
}

function dense(weight: number[][], bias: number[]): Dense {
  const out = weight.length;
  const inn = weight[0].length;
  const w = new Float32Array(out * inn);
  for (let o = 0; o < out; o++) w.set(weight[o], o * inn);
  return { w, b: Float32Array.from(bias), out, in: inn };
}

/**
 * y[yOff + o] = b[o] + Σ_k W[o, colOff + k] · x[xOff + k], for k < n.
 * colOff/n select a column block, so one layer can be fed in pieces.
 */
function addBlock(
  l: Dense,
  colOff: number,
  n: number,
  x: ArrayLike<number>,
  xOff: number,
  y: Float32Array,
  yOff: number
) {
  for (let o = 0; o < l.out; o++) {
    const row = o * l.in + colOff;
    let s = 0;
    for (let k = 0; k < n; k++) s += l.w[row + k] * x[xOff + k];
    y[yOff + o] += s;
  }
}

/** Per-id precomputed W_block · table[id], flattened [id × out]. */
function projectTable(l: Dense, colOff: number, table: number[][]): Float32Array {
  const dim = table[0].length;
  const proj = new Float32Array(table.length * l.out);
  for (let id = 0; id < table.length; id++) {
    addBlock(l, colOff, dim, table[id], 0, proj, id * l.out);
  }
  return proj;
}

function biasReluInPlace(l: Dense, y: Float32Array, yOff: number, relu: boolean) {
  for (let o = 0; o < l.out; o++) {
    const v = y[yOff + o] + l.b[o];
    y[yOff + o] = relu && v < 0 ? 0 : v;
  }
}

export class ValueNet {
  private readonly T: number;
  private readonly TF: number;
  private readonly H: number;
  private readonly HF: number;
  private readonly tile: Dense;
  private readonly hand: Dense;
  private readonly opp: Dense;
  private readonly mine: Dense;
  private readonly fc1: Dense;
  private readonly fc2: Dense;
  private readonly value: Dense;
  private readonly tileAb: Float32Array;
  private readonly tileCh: Float32Array;
  private readonly handAb: Float32Array;
  private readonly handCh: Float32Array;
  // Scratch buffers, reused across calls.
  private readonly trunk: Float32Array;
  private readonly handTmp: Float32Array;
  private readonly h1: Float32Array;
  private readonly h2: Float32Array;
  private readonly out1: Float32Array;

  constructor(file: ValueNetFile) {
    if (file.encoder_version !== ENCODER_VERSION) {
      throw new Error(
        `value net built for encoder v${file.encoder_version}, runtime is v${ENCODER_VERSION}`
      );
    }
    const w = file.weights;
    const lin = (name: string) => dense(w[`${name}.weight`], w[`${name}.bias`]);
    ({
      board_tiles: this.T,
      tile_features: this.TF,
      hand_slots: this.H,
      hand_features: this.HF,
    } = file.dims);

    this.tile = lin("tile");
    this.hand = lin("hand");
    this.opp = lin("opp");
    this.mine = lin("mine");
    this.fc1 = lin("fc1");
    this.fc2 = lin("fc2");
    this.value = lin("value");

    // Layer input order is [features | ability emb | character emb].
    const ab: number[][] = w["ab.weight"];
    const ch: number[][] = w["ch.weight"];
    const emb = ab[0].length;
    this.tileAb = projectTable(this.tile, this.TF, ab);
    this.tileCh = projectTable(this.tile, this.TF + emb, ch);
    this.handAb = projectTable(this.hand, this.HF, ab);
    this.handCh = projectTable(this.hand, this.HF + emb, ch);

    this.trunk = new Float32Array(this.fc1.in);
    this.handTmp = new Float32Array(this.hand.out);
    this.h1 = new Float32Array(this.fc1.out);
    this.h2 = new Float32Array(this.fc2.out);
    this.out1 = new Float32Array(1);
  }

  static load(path: string): ValueNet {
    return new ValueNet(JSON.parse(fs.readFileSync(path, "utf8")));
  }

  /** Expected result in [-1, 1] for the player the state was encoded for. */
  evaluate(e: EncodedState): number {
    const { T, TF, H, HF, tile, hand, trunk } = this;
    trunk.fill(0);
    let off = 0;

    // Board: one tile-layer output per tile, concatenated in board order.
    for (let t = 0; t < T; t++) {
      addBlock(tile, 0, TF, e.tiles, t * TF, trunk, off);
      const a = e.tileAbility[t] * tile.out;
      const c = e.tileCharacter[t] * tile.out;
      for (let o = 0; o < tile.out; o++) {
        trunk[off + o] += this.tileAb[a + o] + this.tileCh[c + o];
      }
      biasReluInPlace(tile, trunk, off, true);
      off += tile.out;
    }

    // Hand: sum-pooled over present slots (masked like training).
    const handTmp = this.handTmp;
    for (let h = 0; h < H; h++) {
      if (!e.hand[h * HF]) continue;
      handTmp.fill(0);
      addBlock(hand, 0, HF, e.hand, h * HF, handTmp, 0);
      const a = e.handAbility[h] * hand.out;
      const c = e.handCharacter[h] * hand.out;
      for (let o = 0; o < hand.out; o++) {
        const v = handTmp[o] + this.handAb[a + o] + this.handCh[c + o] + hand.b[o];
        if (v > 0) trunk[off + o] += v;
      }
    }
    off += hand.out;

    trunk.set(e.scalars, off);
    off += e.scalars.length;

    addBlock(this.opp, 0, this.opp.in, e.oppUnseenAbilities, 0, trunk, off);
    biasReluInPlace(this.opp, trunk, off, true);
    off += this.opp.out;
    addBlock(this.mine, 0, this.mine.in, e.myDeckAbilities, 0, trunk, off);
    biasReluInPlace(this.mine, trunk, off, true);

    this.h1.fill(0);
    addBlock(this.fc1, 0, this.fc1.in, trunk, 0, this.h1, 0);
    biasReluInPlace(this.fc1, this.h1, 0, true);
    this.h2.fill(0);
    addBlock(this.fc2, 0, this.fc2.in, this.h1, 0, this.h2, 0);
    biasReluInPlace(this.fc2, this.h2, 0, true);
    this.out1.fill(0);
    addBlock(this.value, 0, this.value.in, this.h2, 0, this.out1, 0);
    return Math.tanh(this.out1[0] + this.value.b[0]);
  }
}
