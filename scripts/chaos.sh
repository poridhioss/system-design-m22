#!/usr/bin/env bash
# scripts/chaos.sh: kill a random worker, wait 3 seconds, start it again. Repeat 5 times.
for round in 1 2 3 4 5; do
  sleep $((10 + RANDOM % 11))
  worker="worker-$((1 + RANDOM % 3))"
  echo "[chaos] round $round: killing $worker"
  docker compose kill "$worker"
  sleep 3
  echo "[chaos] starting $worker again"
  docker compose start "$worker"
done
echo "[chaos] done"
