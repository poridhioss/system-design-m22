#!/usr/bin/env bash
# scripts/roles.sh: ask each cron replica whether it is the leader
for c in cron-1 cron-2 cron-3; do
  role=$(docker compose exec -T "$c" wget -qO- localhost:3000/health 2>/dev/null \
    | sed 's/.*"role":"\([^"]*\)".*/\1/')
  echo "$c: ${role:-not running}"
done
