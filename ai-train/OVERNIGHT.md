# Overnight AI training

The M5 runs the full loop (self-play → train → mirror match → promote).
The other laptops only generate self-play data for the main machine.

| Machine | Command | Shard range |
|---|---|---|
| M5 MacBook Pro (main) | `ai-train/overnight.sh` | 500… |
| MacBook (helper) | `ai-train/worker.sh mbp` | 600… |
| M1 Air (helper) | `ai-train/worker.sh air` | 700… |

## One-time setup per helper laptop

Run these from `myth-server/` on the helper.

1. Clone the repo and check out the same commit as the main machine.
2. Run `npm install`.
3. Copy these three files from the main machine into the helper's `.ai-sim/` folder:
   - `.ai-sim/vocab.json`
   - `.ai-sim/deck-pool.json`
   - `.ai-sim/models/best.json`

   **The vocab must be byte-identical across machines**, or the data is unusable.
4. Run a smoke test:

   ```
   BATCHES=1 GAMES_PER_SHARD=2 ai-train/worker.sh mbp 2
   ```

   It should finish without errors and leave `shard-*.meta.json` files in `.ai-sim/data-pool/mbp/`.

The main machine also needs the Python venv:

```
python3 -m venv .ai-sim/venv && .ai-sim/venv/bin/pip install torch numpy
```

## Each night

1. Plug every machine in.
2. Start the main loop on the M5 with `ai-train/overnight.sh`.
3. Start each helper with `ai-train/worker.sh mbp` or `ai-train/worker.sh air`.

Both scripts keep the Mac awake while they run.

## Each morning

1. Stop everything with Ctrl-C.
2. Copy each helper's `.ai-sim/data-pool/<name>/` folder into the M5's `.ai-sim/data-pool/`. Copy only finished shards, the ones that have a `.meta.json` file.
3. Read `.ai-sim/ladder.tsv`. It lists each candidate, its score against the best model, and whether it was promoted.
4. Optionally run one more round on all the data:

   ```
   ROUNDS=1 ROUND_BATCHES=0 ai-train/overnight.sh
   ```

5. Copy the helpers the new `best.json` if it changed.
6. **Archive the pool on the M5** before the next night:

   ```
   mkdir -p .ai-sim/data-archive && mv .ai-sim/data-pool .ai-sim/data-archive/$(date +%F)
   ```

   Each night then trains on that night's games, which come from the newest model. Archived games are capped at `OLD_FRAC` (default 50%) of the training rows.

## Shipping

Shipping is always manual. To ship a promoted model:

1. Copy it from `.ai-sim/models/value-vN.json` into `content/ai/`.
2. Set `AI_CONFIG.NEURAL.MODEL_FILE` to that file name.
3. Build, commit and deploy.

## Settings

All settings are environment variables. Set them before the command.

| Variable | Default | Meaning |
|---|---|---|
| `ROUND_BATCHES` | 8 | Self-play batches per round, each `procs × GAMES_PER_SHARD` games |
| `GAMES_PER_SHARD` | 100 | Games per process per batch |
| `MATCH_GAMES` | 400 | Mirror games played between a candidate and the best model |
| `PROMOTE_AT` | 0.53 | Minimum score for a candidate to become `best.json` |
| `ROUNDS` | 0 | Number of rounds to run; 0 means run until stopped |
| `OLD_DATA` | `.ai-sim/data-archive,.ai-sim/data-v4` | Folders of older games to mix in |
| `OLD_FRAC` | 0.5 | Maximum share of older games, as a fraction of the night's rows |

Each round trains two candidates and tests both against `best.json`: `vN` is the standard network and `vNb` is a bigger one, about 220ms per move instead of 140ms. The higher scorer is promoted if it reaches `PROMOTE_AT`.
