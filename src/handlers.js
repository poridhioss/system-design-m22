// src/handlers.js: what each job type does, plus switches to inject failures
const redis = require("./redis");

const WORKER_ID = process.env.WORKER_ID || "worker";
const FAIL_RATE = Number(process.env.FAIL_RATE || 0);
const CRASH_RATE = Number(process.env.CRASH_RATE || 0);
const CRASH_POINT = process.env.CRASH_POINT || "none";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Kill the whole worker process at the chosen point, to simulate a crash.
function maybeCrash(point, job) {
  if (point === CRASH_POINT && Math.random() < CRASH_RATE) {
    console.log(`[${WORKER_ID}] CRASH at ${point} while running job ${job.id.slice(0, 8)}`);
    process.exit(1);
  }
}

const handlers = {
  async credit(job) {
    const { account, amount, workMs = 200 } = job.payload;
    await sleep(workMs); // pretend to do some real work

    if (Math.random() < FAIL_RATE) throw new Error("temporary failure (injected)");

    maybeCrash("before_effect", job);
    await redis.hset(`account:${account}:credits`, job.id, amount); // the effect, safe to repeat
    maybeCrash("after_effect", job);
  },

  // A scheduled job sent by the cron replicas.
  async report(job) {
    await sleep(100); // pretend to build the report
    console.log(`[${WORKER_ID}] built ${job.payload.report} for tick ${job.payload.scheduledFor.slice(11, 19)}`);
  },

  async poison() {
    throw new Error("this job can never succeed");
  },
};

async function runJob(job) {
  const handler = handlers[job.type];
  if (!handler) throw new Error(`unknown job type "${job.type}"`);
  await handler(job);
}

async function getBalance(account) {
  const credits = await redis.hvals(`account:${account}:credits`);
  if (credits.length > 0) return credits.reduce((sum, value) => sum + Number(value), 0);
  return Number((await redis.hget(`account:${account}`, "balance")) || 0);
}

module.exports = { runJob, getBalance };
