# system-design-m22 — Lab 1 complete

Finished code for **Module 22, Lab 1: Job Queue with Retries**, as it stands at the end of the lab
(including the Step 15 fix that makes the `credit` job safe to run twice).

Later labs start from this branch:

```bash
git clone -b lab-01-complete --single-branch https://github.com/poridhioss/system-design-m22.git
```

## What's inside

```text
├── Dockerfile            # one image, used by the api and the workers
├── docker-compose.yml    # redis + api (port 8221) + worker-1, worker-2, worker-3
├── package.json
├── src/
│   ├── redis.js          # the shared Redis connection
│   ├── queue.js          # enqueue, take, finish, fail, recover, move retries
│   ├── handlers.js       # job types: credit (safe to repeat) and poison
│   ├── worker.js         # the worker loop
│   └── api.js            # HTTP API: add jobs, look at jobs, stats
└── scripts/
    ├── send-jobs.js      # sends many credit jobs at once
    ├── check.js          # waits for the queue to empty, prints PASS / FAIL
    └── chaos.sh          # kills random workers and starts them again
```

## Run it

```bash
docker compose up -d --build
docker compose exec api node scripts/send-jobs.js 200
docker compose exec api node scripts/check.js
```
