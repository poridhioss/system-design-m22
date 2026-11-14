# system-design-m22 — Lab 4 complete

Finished code for **Module 22, Lab 4: Integration, the Async Job Tier**. Everything from Labs 1–3
running together (queue with retries and DLQ, priority lanes and fair tenants, a leader-elected
cron), plus a monitor that sends an alarm when the DLQ grows.

## What's inside

```text
├── Dockerfile            # one image for every Node.js service
├── docker-compose.yml    # redis + etcd + api (port 8224) + 3 workers + 3 cron replicas + monitor + alarm-sink
├── package.json
├── src/
│   ├── redis.js          # the shared Redis connection
│   ├── queue.js          # one ready list per lane and tenant, trays, retries, DLQ
│   ├── picker.js         # which lane and which tenant a worker serves next
│   ├── handlers.js       # job types: credit, report (sent by the cron) and poison
│   ├── worker.js         # asks the picker for a job, runs it
│   ├── api.js            # HTTP API: add jobs with priority + tenant, stats
│   ├── cron.js           # the scheduler: tick key + leader election with etcd
│   ├── monitor.js        # watches the DLQ, sends an alarm when it grows
│   └── alarm-sink.js     # receives alarms and records when they arrived
└── scripts/
    ├── roles.sh          # asks each cron replica whether it is the leader
    ├── check-ticks.js    # counts how many jobs each tick created
    ├── load-test.js      # a minute of mixed traffic with poison pills
    ├── chaos.sh          # kills a worker and the cron leader during the load test
    └── check-all.js      # checks every promise of the job tier after the load test
```

## Run the final test

```bash
docker compose up -d --build
FAIL_RATE=0.05 docker compose up -d
docker compose exec redis redis-cli FLUSHALL

# in a second terminal: ./scripts/chaos.sh
docker compose exec api node scripts/load-test.js
docker compose exec api node scripts/check-all.js
```
