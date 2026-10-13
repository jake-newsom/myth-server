"""
Trains the value network on self-play shards from
src/game-engine/sim/cli/selfplay.ts and exports weights as JSON for the
TypeScript forward pass in src/game-engine/sim/sim.valueNet.ts.

    .ai-sim/venv/bin/python ai-train/train_value.py \
        [--data .ai-sim/data] [--out .ai-sim/models/value-v1.json] [--epochs 12]

The architecture is deliberately limited to ops the TS side re-implements
(embedding lookup, linear, relu, sum, concat, tanh). Change both together.
"""
import argparse
import glob
import json
import os

import numpy as np
import torch
import torch.nn as nn

p = argparse.ArgumentParser()
p.add_argument("--data", default=".ai-sim/data")
p.add_argument("--out", default=".ai-sim/models/value-v1.json")
p.add_argument("--epochs", type=int, default=12)
p.add_argument("--batch", type=int, default=1024)
p.add_argument("--lr", type=float, default=1e-3)
p.add_argument("--val-shards", type=int, default=1)
args = p.parse_args()

# --data takes a comma-separated list of shard dirs (e.g. every self-play
# round so far); the last --val-shards of EACH dir are held out.
train_metas, val_metas = [], []
for d in args.data.split(","):
    found = sorted(glob.glob(os.path.join(d, "shard-*.meta.json")))
    if not found:
        raise SystemExit(f"no shards in {d}")
    train_metas += found[: -args.val_shards]
    val_metas += found[-args.val_shards :]
meta = json.load(open(train_metas[0]))
FD, ID = meta["float_dim"], meta["int_dim"]
T, TF = meta["board_tiles"], meta["tile_features"]
H, HF = meta["hand_slots"], meta["hand_features"]
S = meta["scalar_count"]
AV, CV = meta["ability_vocab"], meta["character_vocab"]


def load(meta_paths):
    fs, is_ = [], []
    for mp in meta_paths:
        m = json.load(open(mp))
        assert m["float_dim"] == FD and m["int_dim"] == ID, mp
        base = mp[: -len(".meta.json")]
        fs.append(np.fromfile(base + ".f32", dtype="<f4").reshape(-1, FD))
        is_.append(np.fromfile(base + ".i16", dtype="<i2").reshape(-1, ID))
    return np.concatenate(fs), np.concatenate(is_).astype(np.int64)


# Split by shard, not by row: rows from one game are highly correlated.
train_f, train_i = load(train_metas)
val_f, val_i = load(val_metas)
print(f"train rows {len(train_f)}, val rows {len(val_f)}")

# Float row layout (see selfplay.ts floatRow).
o_tiles = 0
o_hand = o_tiles + T * TF
o_scal = o_hand + H * HF
o_opp = o_scal + S
o_mine = o_opp + AV
o_z = o_mine + AV
assert o_z + 2 == FD


class ValueNet(nn.Module):
    def __init__(self, emb=12, tile_h=24, hand_h=24, hidden=192):
        super().__init__()
        self.ab = nn.Embedding(AV, emb)
        self.ch = nn.Embedding(CV, emb)
        self.tile = nn.Linear(TF + 2 * emb, tile_h)
        self.hand = nn.Linear(HF + 2 * emb, hand_h)
        self.opp = nn.Linear(AV, 24)
        self.mine = nn.Linear(AV, 24)
        trunk_in = T * tile_h + hand_h + S + 24 + 24
        self.fc1 = nn.Linear(trunk_in, hidden)
        self.fc2 = nn.Linear(hidden, hidden // 2)
        self.value = nn.Linear(hidden // 2, 1)
        self.margin = nn.Linear(hidden // 2, 1)
        # Train-time only; the TS forward pass is the eval-mode network.
        self.drop = nn.Dropout(0.3)

    def forward(self, f, i):
        b = f.shape[0]
        tiles = f[:, o_tiles:o_hand].view(b, T, TF)
        hand = f[:, o_hand:o_scal].view(b, H, HF)
        ta, tc = i[:, 0:T], i[:, T : 2 * T]
        ha, hc = i[:, 2 * T : 2 * T + H], i[:, 2 * T + H : 2 * T + 2 * H]
        # Position matters on the board, so tiles are concatenated in order;
        # hand order doesn't, so hand slots are sum-pooled.
        t = torch.relu(self.tile(torch.cat([tiles, self.ab(ta), self.ch(tc)], -1)))
        h = torch.relu(self.hand(torch.cat([hand, self.ab(ha), self.ch(hc)], -1)))
        h = (h * hand[:, :, :1]).sum(1)  # mask empty slots via the "present" flag
        x = torch.cat(
            [
                t.reshape(b, -1),
                h,
                f[:, o_scal:o_opp],
                torch.relu(self.opp(f[:, o_opp:o_mine])),
                torch.relu(self.mine(f[:, o_mine:o_z])),
            ],
            -1,
        )
        x = torch.relu(self.fc2(self.drop(torch.relu(self.fc1(self.drop(x))))))
        return torch.tanh(self.value(x)).squeeze(-1), self.margin(x).squeeze(-1)


dev = "mps" if torch.backends.mps.is_available() else "cpu"
model = ValueNet().to(dev)
print(f"params: {sum(p.numel() for p in model.parameters()):,}  device: {dev}")
opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-2)
sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, args.epochs)

tf, ti = torch.from_numpy(train_f), torch.from_numpy(train_i)
vf, vi = torch.from_numpy(val_f).to(dev), torch.from_numpy(val_i).to(dev)


def evaluate():
    model.eval()
    with torch.no_grad():
        vs = []
        for k in range(0, len(vf), 8192):
            v, _ = model(vf[k : k + 8192], vi[k : k + 8192])
            vs.append(v)
        v = torch.cat(vs)
    z = vf[:, o_z]
    decisive = z != 0
    mse = ((v - z) ** 2).mean().item()
    acc = ((v[decisive] > 0) == (z[decisive] > 0)).float().mean().item()
    # Baseline: "whoever owns more tiles right now wins".
    lead = vf[:, o_scal + 1] - vf[:, o_scal + 2]
    base_acc = ((lead[decisive] > 0) == (z[decisive] > 0)).float().mean().item()
    model.train()
    return mse, acc, base_acc


best_mse, best_state = float("inf"), None
for epoch in range(args.epochs):
    perm = torch.randperm(len(tf))
    total = 0.0
    for k in range(0, len(tf), args.batch):
        idx = perm[k : k + args.batch]
        f, i = tf[idx].to(dev), ti[idx].to(dev)
        v, m = model(f, i)
        loss = ((v - f[:, o_z]) ** 2).mean() + 0.5 * ((m - f[:, o_z + 1]) ** 2).mean()
        opt.zero_grad()
        loss.backward()
        opt.step()
        total += loss.item() * len(idx)
    sched.step()
    mse, acc, base = evaluate()
    # Positions within a game are highly correlated, so the net overfits fast;
    # keep the best validation checkpoint rather than the last epoch.
    if mse < best_mse:
        best_mse = mse
        best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}
    print(
        f"epoch {epoch + 1:2d}  train loss {total / len(tf):.4f}  "
        f"val mse {mse:.4f}  val win-acc {acc:.3f}  (board-lead baseline {base:.3f})"
    )

os.makedirs(os.path.dirname(args.out), exist_ok=True)
print(f"best val mse {best_mse:.4f}")
weights = {k: v.cpu().numpy().tolist() for k, v in best_state.items()}
json.dump(
    {
        "encoder_version": meta["encoder_version"],
        "dims": {k: meta[k] for k in ("float_dim", "int_dim", "board_tiles", "tile_features",
                                      "hand_slots", "hand_features", "scalar_count",
                                      "ability_vocab", "character_vocab")},
        "weights": weights,
    },
    open(args.out, "w"),
)
print(f"weights → {args.out}")
