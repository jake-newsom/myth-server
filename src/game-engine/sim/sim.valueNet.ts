import * as fs from "fs";
import { EncodedState, ENCODER_VERSION } from "./sim.encoder";

/**
 * Pure-TS forward pass for the value network trained by
 * ai-train/train_value.py. Mirrors ValueNet.forward exactly; change both
 * together. No native deps, so it can run inside the game server as-is.
 */
type Matrix = number[][];

interface Linear {
  w: Matrix; // [out][in], PyTorch layout
  b: number[];
}

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

function linear(l: Linear, x: number[], relu: boolean): number[] {
  const out = new Array(l.b.length);
  for (let o = 0; o < l.b.length; o++) {
    const row = l.w[o];
    let s = l.b[o];
    for (let k = 0; k < x.length; k++) s += row[k] * x[k];
    out[o] = relu && s < 0 ? 0 : s;
  }
  return out;
}

export class ValueNet {
  private readonly ab: Matrix;
  private readonly ch: Matrix;
  private readonly tile: Linear;
  private readonly hand: Linear;
  private readonly opp: Linear;
  private readonly mine: Linear;
  private readonly fc1: Linear;
  private readonly fc2: Linear;
  private readonly value: Linear;

  constructor(private readonly file: ValueNetFile) {
    if (file.encoder_version !== ENCODER_VERSION) {
      throw new Error(
        `value net built for encoder v${file.encoder_version}, runtime is v${ENCODER_VERSION}`
      );
    }
    const w = file.weights;
    const lin = (name: string): Linear => ({
      w: w[`${name}.weight`],
      b: w[`${name}.bias`],
    });
    this.ab = w["ab.weight"];
    this.ch = w["ch.weight"];
    this.tile = lin("tile");
    this.hand = lin("hand");
    this.opp = lin("opp");
    this.mine = lin("mine");
    this.fc1 = lin("fc1");
    this.fc2 = lin("fc2");
    this.value = lin("value");
  }

  static load(path: string): ValueNet {
    return new ValueNet(JSON.parse(fs.readFileSync(path, "utf8")));
  }

  /** Expected result in [-1, 1] for the player the state was encoded for. */
  evaluate(e: EncodedState): number {
    const { board_tiles: T, tile_features: TF, hand_slots: H, hand_features: HF } =
      this.file.dims;

    const trunk: number[] = [];
    for (let t = 0; t < T; t++) {
      const x = [
        ...e.tiles.slice(t * TF, (t + 1) * TF),
        ...this.ab[e.tileAbility[t]],
        ...this.ch[e.tileCharacter[t]],
      ];
      trunk.push(...linear(this.tile, x, true));
    }

    const handSum = new Array(this.hand.b.length).fill(0);
    for (let h = 0; h < H; h++) {
      const feats = e.hand.slice(h * HF, (h + 1) * HF);
      if (!feats[0]) continue; // empty slot ("present" flag), masked in training too
      const y = linear(
        this.hand,
        [...feats, ...this.ab[e.handAbility[h]], ...this.ch[e.handCharacter[h]]],
        true
      );
      for (let k = 0; k < y.length; k++) handSum[k] += y[k];
    }
    trunk.push(...handSum, ...e.scalars);
    trunk.push(...linear(this.opp, e.oppUnseenAbilities, true));
    trunk.push(...linear(this.mine, e.myDeckAbilities, true));

    const x = linear(this.fc2, linear(this.fc1, trunk, true), true);
    return Math.tanh(linear(this.value, x, false)[0]);
  }
}
