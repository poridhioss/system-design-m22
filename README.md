# system-design-m22 — Lab 2 complete

Finished code for **Module 22, Lab 2: Priority & Fair Scheduling**. It is Lab 1's job queue
with priority lanes (`high`, `normal`, `low`) and one line per tenant inside each lane.

Later labs start from this branch:

```bash
git clone -b lab-02-complete --single-branch https://github.com/poridhioss/system-design-m22.git
```

## What's inside

```text
├── Dockerfile            # one image, used by the api and the workers
├── docker-compose.yml    # redis + api (port 8222) + worker-1, worker-2, worker-3
├── package.json
├── src/
│   ├── redis.js          # the shared Redis connection
│   ├── queue.js          # one ready list per lane and tenant, trays, retries, DLQ
│   ├── picker.js         # which lane (strict / weighted) and which tenant (oldest-first / take-turns)
│   ├── handlers.js       # job types: credit (safe to repeat) and poison
│   ├── worker.js         # asks the picker for a job, runs it
│   └── api.js            # HTTP API: add jobs with priority + tenant, stats
└── scripts/
    ├── scenario.js       # sends a pattern of jobs and prints live progress
    └── report.js         # wait time per lane and per tenant
```

## Run it

```bash
docker compose up -d --build
docker compose exec api node scripts/scenario.js mixed
docker compose exec api node scripts/report.js
```

Switch the picking rules with `LANE_RULE=strict|weighted` and `TENANT_RULE=oldest-first|take-turns`,
for example `LANE_RULE=strict docker compose up -d`.
