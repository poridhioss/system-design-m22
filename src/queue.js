// src/queue.js: a small job queue built on plain Redis lists and sorted sets
const { randomUUID } = require("crypto");
const redis = require("./redis");

const READY = "q:ready";       // list: jobs waiting to run
const DELAYED = "q:delayed";   // sorted set: jobs waiting to be retried, scored by retry time
const DLQ = "q:dlq";           // list: jobs that failed too many times
const trayKey = (workerId) => `q:processing:${workerId}`; // list: the job a worker is running
const jobKey = (id) => `job:${id}`;                       // hash: the job's details

// Add a job. If the idempotency key was seen before, return the existing job instead.
async function enqueue({ type, payload, maxAttempts, idempotencyKey }) {
  const id = randomUUID();

  if (idempotencyKey) {
    // NX = only set if the key does not exist yet. EX 86400 = forget the key after 24 hours.
    const isNew = await redis.set(`idem:${idempotencyKey}`, id, "EX", 86400, "NX");
    if (!isNew) {
      const existingId = await redis.get(`idem:${idempotencyKey}`);
      return { id: existingId, duplicate: true };
    }
  }

  // multi() sends both commands as one package: Redis runs them together.
  await redis
    .multi()
    .hset(jobKey(id), {
      id,
      type,
      payload: JSON.stringify(payload),
      attempts: 0,
      maxAttempts,
      status: "queued",
      createdAt: Date.now(),
    })
    .lpush(READY, id)
    .exec();

  return { id, duplicate: false };
}

// Read a job's details from Redis.
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

// Take the next job and put it on this worker's tray, in ONE step.
// Waits up to 5 seconds for a job to arrive; returns null if none did.
async function take(workerId) {
  const id = await redis.blmove(READY, trayKey(workerId), "RIGHT", "LEFT", 5);
  if (!id) return null;
  await redis.hset(jobKey(id), "status", "running", "worker", workerId);
  return getJob(id);
}

// The job succeeded: mark it done and take it off the tray.
async function finish(workerId, job) {
  await redis
    .multi()
    .hset(jobKey(job.id), "status", "done", "finishedAt", Date.now())
    .lrem(trayKey(workerId), 1, job.id)
    .exec();
}

// How long to wait before the next try: 1 s, 2 s, 4 s, 8 s ... plus up to 0.5 s of
// randomness, so jobs that failed together don't all retry at the same instant.
function backoffMs(attempts) {
  return 1000 * 2 ** (attempts - 1) + Math.random() * 500;
}

// The job failed: either schedule a retry, or move it to the DLQ if it has no attempts left.
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

// Called when a worker starts. Anything still on its tray was interrupted by a crash,
// so it is treated as a failed attempt and goes through the normal retry path.
async function recover(workerId) {
  const ids = await redis.lrange(trayKey(workerId), 0, -1);
  for (const id of ids) {
    const job = await getJob(id);
    await fail(workerId, job, "worker crashed while running this job");
  }
  return ids;
}

// Move retries whose wait is over back to the ready list.
// Only the api runs this, every 0.5 s. There is only one api, so only one mover.
async function moveDueJobs() {
  const dueIds = await redis.zrangebyscore(DELAYED, 0, Date.now());
  for (const id of dueIds) {
    await redis
      .multi()
      .zrem(DELAYED, id)
      .lpush(READY, id)
      .hset(jobKey(id), "status", "queued")
      .exec();
  }
}

// Counts for the /stats endpoint and the check script.
async function stats() {
  // KEYS is fine for a small lab; on a big production Redis, use SCAN instead.
  const trays = await redis.keys("q:processing:*");
  const processing = {};
  for (const tray of trays) {
    processing[tray.replace("q:processing:", "")] = await redis.llen(tray);
  }
  return {
    ready: await redis.llen(READY),
    delayed: await redis.zcard(DELAYED),
    dlq: await redis.llen(DLQ),
    processing,
  };
}

module.exports = { enqueue, getJob, take, finish, fail, recover, moveDueJobs, stats };
