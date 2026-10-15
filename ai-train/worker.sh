#!/usr/bin/env bash
# Generates value-net training data with the current best model until stopped
# (Ctrl-C), or for $BATCHES batches. Run one per machine:
#
#   ai-train/worker.sh m5      # main machine (overnight.sh runs this itself)
#   ai-train/worker.sh mbp     # helper laptop
#   ai-train/worker.sh air     # M1 Air: fewer processes, it throttles
#
# Each name owns its own shard-number range, so machines never repeat a game.
# Shards land in .ai-sim/data-pool/<name>/; copy helper folders into the main
# machine's .ai-sim/data-pool/ before training. Each morning, archive the pool
# (see OVERNIGHT.md) so the next night trains mostly on the newest model's games.
set -euo pipefail
cd "$(dirname "$0")/.."

NAME=${1:?usage: worker.sh <m5|mbp|air> [procs]}
case "$NAME" in
  m5) BASE=500 ;;
  mbp) BASE=600 ;;
  air) BASE=700 ;;
  *) echo "unknown machine name: $NAME (use m5, mbp or air)"; exit 1 ;;
esac
DEFAULT_PROCS=$(( $(sysctl -n hw.ncpu) - 1 ))
[ "$NAME" = air ] && DEFAULT_PROCS=6
PROCS=${2:-$DEFAULT_PROCS}
GAMES_PER_SHARD=${GAMES_PER_SHARD:-100}
BATCHES=${BATCHES:-0} # 0 = run until stopped
MODEL=.ai-sim/models/best.json
OUT=.ai-sim/data-pool/$NAME

for f in "$MODEL" .ai-sim/vocab.json .ai-sim/deck-pool.json; do
  [ -f "$f" ] || { echo "missing $f (see ai-train/OVERNIGHT.md)"; exit 1; }
done
mkdir -p "$OUT"

# Keep the Mac awake (on power) for as long as this script runs.
if [ -z "${CAFFEINATED:-}" ]; then
  CAFFEINATED=1 exec caffeinate -is "$0" "$@"
fi

# Next unused shard number, persisted so restarts never reuse seeds.
NEXT_FILE=$OUT/.next-shard
[ -f "$NEXT_FILE" ] || echo $(( BASE * 10000 )) > "$NEXT_FILE"

trap 'kill 0' INT TERM
batch=0
while [ "$BATCHES" = 0 ] || [ "$batch" -lt "$BATCHES" ]; do
  first=$(cat "$NEXT_FILE")
  echo $(( first + PROCS )) > "$NEXT_FILE"
  model_hash=$(shasum "$MODEL" | cut -c1-8)
  echo "[$(date +%H:%M)] $NAME batch $batch: shards $first..$(( first + PROCS - 1 )), $PROCS × $GAMES_PER_SHARD games, model $model_hash"
  for (( i = 0; i < PROCS; i++ )); do
    TS_NODE_TRANSPILE_ONLY=true npx ts-node src/game-engine/sim/cli/selfplay.ts \
      --a "search:$MODEL" --b "search:$MODEL" \
      --games "$GAMES_PER_SHARD" --shard $(( first + i )) \
      --mirror-share 0.5 --explore 0.25 --target-mix 0.5 \
      --tag "$model_hash" --out "$OUT" > "$OUT/shard-$(( first + i )).log" 2>&1 &
  done
  wait
  batch=$(( batch + 1 ))
done
