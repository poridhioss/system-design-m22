#!/usr/bin/env bash
# scripts/roles.sh: ask each cron replica whether it is the leader
#   ./scripts/roles.sh          prints every replica's role
#   ./scripts/roles.sh leader   prints only the leader's name
for c in cron-1 cron-2 cron-3; do
  role=$(docker compose exec -T "$c" wget -qO- localhost:3000/health 2>/dev/null </dev/null \
    | sed 's/.*"role":"\([^"]*\)".*/\1/')
  if [ "$1" = "leader" ]; then
    if [ "$role" = "leader" ]; then echo "$c"; fi
  else
    echo "$c: ${role:-not running}"
  fi
done
