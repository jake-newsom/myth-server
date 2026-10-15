#!/usr/bin/env bash
# Main-machine improvement loop. Each round:
#   1. self-play with the best model (worker.sh m5) for $ROUND_BATCHES batches
#   2. train two candidates (standard and bigger net) on .ai-sim/data-pool plus
#      a capped share of $OLD_DATA
#   3. mirror-match each vs best; promote the higher scorer to best.json if it
#      scores at least $PROMOTE_AT
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
# Archived nights (older, weaker models) fill at most OLD_FRAC of training rows.
OLD_DATA=${OLD_DATA:-.ai-sim/data-archive,.ai-sim/data-v4}
OLD_FRAC=${OLD_FRAC:-0.5}
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
  # Two candidates per round: the standard net (vN) and a bigger one (vNb).
  # Both train on this night's pool plus a capped share of archived data.
  rows=""
  for size in std big; do
    if [ "$size" = std ]; then name=v$v; dims=""; else name=v${v}b; dims="--tile-h 32 --hand-h 32 --hidden 384"; fi
    echo "== round $round: training $name"
    # shellcheck disable=SC2086
    .ai-sim/venv/bin/python ai-train/train_value.py \
      --data .ai-sim/data-pool --old-data "$OLD_DATA" --old-frac "$OLD_FRAC" \
      $dims --out ".ai-sim/models/value-$name.json" \
      > ".ai-sim/train-$name.log" 2>&1
    rows=$(grep -o "train rows [0-9]*" ".ai-sim/train-$name.log" | grep -o "[0-9]*$")
  done

  best_name=""; best_score=0
  for name in "v$v" "v${v}b"; do
    cand=.ai-sim/models/value-$name.json
    echo "== round $round: $name vs best, $MATCH_GAMES mirror games"
    per=$(( (MATCH_GAMES + PROCS - 1) / PROCS ))
    per=$(( per + per % 2 ))
    seed_base=$(( RANDOM * 100 ))
    for (( i = 0; i < PROCS; i++ )); do
      TS_NODE_TRANSPILE_ONLY=true npx ts-node src/game-engine/sim/cli/match.ts \
        --a "search:$cand" --b "search:$BEST" --games "$per" \
        --seed $(( seed_base + i )) --mirror > ".ai-sim/match-$name-$i.log" 2>&1 &
    done
    wait
    read -r score ci < <(grep -h "W .*L .*D" .ai-sim/match-$name-*.log | awk '
      { w += $2; l += $3; d += $4 }
      END { n = w + l + d; s = (w + d / 2) / n; printf "%.3f %.3f\n", s, 1.96 * sqrt(s * (1 - s) / n) }')
    printf "%s\t%s\t%s\t%s\t-\t%s\n" "$(date '+%F %H:%M')" "$name" "$score" "$ci" "$rows" >> "$LADDER"
    echo "== round $round: $name scored $score ± $ci"
    if awk -v s="$score" -v b="$best_score" 'BEGIN { exit !(s > b) }'; then
      best_name=$name; best_score=$score
    fi
  done

  if awk -v s="$best_score" -v t="$PROMOTE_AT" 'BEGIN { exit !(s >= t) }'; then
    cp ".ai-sim/models/value-$best_name.json" "$BEST"
    printf "%s\t%s\t%s\t-\tPROMOTED\t-\n" "$(date '+%F %H:%M')" "$best_name" "$best_score" >> "$LADDER"
    echo "== round $round: promoted $best_name"
  fi
  round=$(( round + 1 ))
done
