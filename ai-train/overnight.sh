#!/usr/bin/env bash
# Main-machine improvement loop. Each round:
#   1. self-play with the best model (worker.sh m5) for $ROUND_BATCHES batches
#   2. train a candidate on .ai-sim/data-v4 + everything in .ai-sim/data-pool
#   3. mirror-match candidate vs best; promote it to best.json if it scores
#      at least $PROMOTE_AT
# Runs until stopped (Ctrl-C) or $ROUNDS rounds. Never touches content/ai/ —
# shipping a model stays a manual step. Progress: .ai-sim/ladder.tsv.
#
#   ai-train/overnight.sh
set -euo pipefail
cd "$(dirname "$0")/.."

PROCS=${PROCS:-$(( $(sysctl -n hw.ncpu) - 1 ))}
ROUND_BATCHES=${ROUND_BATCHES:-8}
ROUNDS=${ROUNDS:-0} # 0 = until stopped
MATCH_GAMES=${MATCH_GAMES:-400}
PROMOTE_AT=${PROMOTE_AT:-0.53}
BEST=.ai-sim/models/best.json
LADDER=.ai-sim/ladder.tsv

[ -f "$BEST" ] || { echo "missing $BEST (see ai-train/OVERNIGHT.md)"; exit 1; }
[ -f "$LADDER" ] || printf "time\tcandidate\tscore\tci\tpromoted\ttrain_rows\n" > "$LADDER"

if [ -z "${CAFFEINATED:-}" ]; then
  CAFFEINATED=1 exec caffeinate -is "$0" "$@"
fi
trap 'kill 0' INT TERM

next_version() {
  local n=4
  for f in .ai-sim/models/value-v*.json; do
    v=${f##*value-v}; v=${v%.json}
    [[ "$v" =~ ^[0-9]+$ ]] && (( v >= n )) && n=$(( v + 1 ))
  done
  echo "$n"
}

round=0
while [ "$ROUNDS" = 0 ] || [ "$round" -lt "$ROUNDS" ]; do
  # ROUND_BATCHES=0: train on the data already collected (worker.sh treats
  # BATCHES=0 as "forever", so skip it entirely).
  if [ "$ROUND_BATCHES" -gt 0 ]; then
    echo "== round $round: self-play"
    BATCHES=$ROUND_BATCHES ai-train/worker.sh m5 "$PROCS"
  fi

  v=$(next_version)
  cand=.ai-sim/models/value-v$v.json
  echo "== round $round: training v$v"
  .ai-sim/venv/bin/python ai-train/train_value.py \
    --data .ai-sim/data-v4,.ai-sim/data-pool --out "$cand" \
    > ".ai-sim/train-v$v.log" 2>&1
  rows=$(grep -o "train rows [0-9]*" ".ai-sim/train-v$v.log" | grep -o "[0-9]*$")

  echo "== round $round: v$v vs best, $MATCH_GAMES mirror games"
  per=$(( (MATCH_GAMES + PROCS - 1) / PROCS ))
  per=$(( per + per % 2 ))
  seed_base=$(( RANDOM * 100 ))
  for (( i = 0; i < PROCS; i++ )); do
    TS_NODE_TRANSPILE_ONLY=true npx ts-node src/game-engine/sim/cli/match.ts \
      --a "search:$cand" --b "search:$BEST" --games "$per" \
      --seed $(( seed_base + i )) --mirror > ".ai-sim/match-v$v-$i.log" 2>&1 &
  done
  wait
  read -r score ci < <(grep -h "W .*L .*D" .ai-sim/match-v$v-*.log | awk '
    { w += $2; l += $3; d += $4 }
    END { n = w + l + d; s = (w + d / 2) / n; printf "%.3f %.3f\n", s, 1.96 * sqrt(s * (1 - s) / n) }')

  promoted=no
  if awk -v s="$score" -v t="$PROMOTE_AT" 'BEGIN { exit !(s >= t) }'; then
    cp "$cand" "$BEST"
    promoted=yes
  fi
  printf "%s\tv%s\t%s\t%s\t%s\t%s\n" "$(date '+%F %H:%M')" "$v" "$score" "$ci" "$promoted" "$rows" >> "$LADDER"
  echo "== round $round: v$v scored $score ± $ci → promoted: $promoted"
  round=$(( round + 1 ))
done
