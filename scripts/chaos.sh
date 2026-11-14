#!/usr/bin/env bash
# scripts/chaos.sh: during the load test, kill one worker and the cron leader, then bring them back
sleep 15
echo "[chaos] $(date -u +%T) killing worker-2"
docker compose kill worker-2
sleep 5
echo "[chaos] $(date -u +%T) starting worker-2 again"
docker compose start worker-2

sleep 10
leader=$(./scripts/roles.sh leader)
if [ -n "$leader" ]; then
  echo "[chaos] $(date -u +%T) killing the cron leader ($leader)"
  docker compose kill "$leader"
  sleep 15
  echo "[chaos] $(date -u +%T) starting $leader again"
  docker compose start "$leader"
fi
echo "[chaos] done"
