// src/queue.js: Lab 1's queue, with one ready list per lane and tenant
const { randomUUID } = require("crypto");
const redis = require("./redis");

const LANES = ["high", "normal", "low"];
const DELAYED = "q:delayed"; // sorted set: jobs waiting to be retried, scored by retry time
const DLQ = "q:dlq";         // list: jobs that failed too many times
const TENANTS = "q:tenants"; // set: every tenant that has sent a job
const readyKey = (lane, tenant) => `q:ready:${lane}:${tenant}`; // list: waiting jobs
const trayKey = (workerId) => `q:processing:${workerId}`;       // list: the job a worker is running
const jobKey = (id) => `job:${id}`;                             // hash: the job's details

// Add a job to its lane and its tenant's line.
async function enqueue({ type, payload, maxAttempts, idempotencyKey, priority, tenant }) {
  const id = randomUUID();

  if (idempotencyKey) {
    const isNew = await redis.set(`idem:${idempotencyKey}`, id, "EX", 86400, "NX");
    if (!isNew) {
      const existingId = await redis.get(`idem:${idempotencyKey}`);
      return { id: existingId, duplicate: true };
    }
  }

  await redis
    .multi()
    .hset(jobKey(id), {
      id,
      type,
      payload: JSON.stringify(payload),
      priority,
      tenant,
      attempts: 0,
      maxAttempts,
      status: "queued",
      createdAt: Date.now(),
    })
    .sadd(TENANTS, tenant)
    .lpush(readyKey(priority, tenant), id)
    .exec();

  return { id, duplicate: false };
}

async function getJob(id) {
  const data = await redis.hgetall(jobKey(id));
  if (!data.id) return null;
  return {
    ...data,
    payload: JSON.parse(data.payload),
    attempts: Number(data.attempts),
    maxAttempts: Number(data.maxAttempts),
  };
}

// --- helpers the picker uses to look at the lines ---

async function getTenants() {
  return (await redis.smembers(TENANTS)).sort();
}

async function waitingCount(lane, tenant) {
  return redis.llen(readyKey(lane, tenant));
}

// When was the next job in this tenant's line added? (null if the line is empty)
async function oldestCreatedAt(lane, tenant) {
  const id = await redis.lindex(readyKey(lane, tenant), -1); // the right end is the oldest
  if (!id) return null;
  return Number(await redis.hget(jobKey(id), "createdAt"));
}

// Take the next job from ONE tenant's line in ONE lane, and put it on the worker's tray.
// Returns null if that line is empty (another worker may have just taken the last job).
async function take(workerId, lane, tenant) {
  const id = await redis.lmove(readyKey(lane, tenant), trayKey(workerId), "RIGHT", "LEFT");
  if (!id) return null;
  await redis
    .multi()
    .hset(jobKey(id), "status", "running", "worker", workerId)
    .hsetnx(jobKey(id), "startedAt", Date.now()) // only the FIRST start counts for wait time
    .exec();
  return getJob(id);
}

async function finish(workerId, job) {
  await redis
    .multi()
    .hset(jobKey(job.id), "status", "done", "finishedAt", Date.now())
    .lrem(trayKey(workerId), 1, job.id)
    .incr(`stats:done:${job.priority}`)
    .incr(`stats:done:tenant:${job.tenant}`)
    .exec();
}

function backoffMs(attempts) {
  return 1000 * 2 ** (attempts - 1) + Math.random() * 500;
}

async function fail(workerId, job, errorMessage) {
  const attempts = job.attempts + 1;
  const tx = redis
    .multi()
    .hset(jobKey(job.id), "attempts", attempts, "lastError", errorMessage)
    .lrem(trayKey(workerId), 1, job.id);

  if (attempts >= job.maxAttempts) {
    tx.hset(jobKey(job.id), "status", "dead").lpush(DLQ, job.id);
    await tx.exec();
    return { dead: true, attempts };
  }

  const delayMs = backoffMs(attempts);
  tx.hset(jobKey(job.id), "status", "waiting_retry").zadd(DELAYED, Date.now() + delayMs, job.id);
  await tx.exec();
  return { dead: false, attempts, delayMs };
}

async function recover(workerId) {
  const ids = await redis.lrange(trayKey(workerId), 0, -1);
  for (const id of ids) {
    const job = await getJob(id);
    await fail(workerId, job, "worker crashed while running this job");
  }
  return ids;
}

// Move retries whose wait is over back to their own lane and tenant line.
async function moveDueJobs() {
  const dueIds = await redis.zrangebyscore(DELAYED, 0, Date.now());
  for (const id of dueIds) {
    const [priority, tenant] = await redis.hmget(jobKey(id), "priority", "tenant");
    await redis
      .multi()
      .zrem(DELAYED, id)
      .lpush(readyKey(priority, tenant), id)
      .hset(jobKey(id), "status", "queued")
      .exec();
  }
}

// Counts for the /stats endpoint and the live progress view.
async function stats() {
  const tenants = await getTenants();
  const waiting = {};
  const done = {};
  for (const lane of LANES) {
    waiting[lane] = 0;
    for (const tenant of tenants) waiting[lane] += await waitingCount(lane, tenant);
    done[lane] = Number((await redis.get(`stats:done:${lane}`)) || 0);
  }

  const doneByTenant = {};
  for (const tenant of tenants) {
    doneByTenant[tenant] = Number((await redis.get(`stats:done:tenant:${tenant}`)) || 0);
  }

  // KEYS is fine for a small lab; on a big production Redis, use SCAN instead.
  let running = 0;
  for (const tray of await redis.keys("q:processing:*")) running += await redis.llen(tray);

  return {
    waiting,
    done,
    doneByTenant,
    running,
    delayed: await redis.zcard(DELAYED),
    dlq: await redis.llen(DLQ),
  };
}

module.exports = {
  LANES,
  enqueue,
  getJob,
  getTenants,
  waitingCount,
  oldestCreatedAt,
  take,
  finish,
  fail,
  recover,
  moveDueJobs,
  stats,
};
