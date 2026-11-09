# system-design-m22 — Lab 3 complete

Finished code for **Module 22, Lab 3: Distributed Cron with Leader Election**. It is Lab 2's job
queue plus three cron replicas that send a `report` job every 10 seconds. Each tick carries an
idempotency key (the tick key), and only the replica elected leader through etcd sends it.

Later labs start from this branch:

```bash
git clone -b lab-03-complete --single-branch https://github.com/poridhioss/system-design-m22.git
```

## What's inside

```text
├── Dockerfile            # one image, used by the api, worker and cron replicas
├── docker-compose.yml    # redis + etcd + api (port 8223) + worker-1 + cron-1, cron-2, cron-3
├── package.json          # adds etcd3 and node-cron
├── src/
│   ├── redis.js          # the shared Redis connection
│   ├── queue.js          # one ready list per lane and tenant, trays, retries, DLQ
│   ├── picker.js         # which lane and which tenant a worker serves next
│   ├── handlers.js       # job types: credit, report (sent by the cron) and poison
│   ├── worker.js         # asks the picker for a job, runs it
│   ├── api.js            # HTTP API: add jobs with priority + tenant, stats
│   └── cron.js           # the scheduler: tick key + leader election with etcd
└── scripts/
    ├── roles.sh          # asks each cron replica whether it is the leader
    └── check-ticks.js    # counts how many jobs each tick created
```

## Run it

```bash
docker compose up -d --build
sleep 30
./scripts/roles.sh
docker compose exec api node scripts/check-ticks.js
```

Turn the fixes off with `USE_KEY=false` and `USE_LEADER=false`,
for example `USE_KEY=false USE_LEADER=false docker compose up -d`.
